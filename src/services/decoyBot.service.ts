import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { IDecoyMessage, MediaKind } from '../models/decoySession.model';
import { IDecoyTelegramAccount } from '../models/decoyTelegramAccount.model';
import { DecoySessionRepository } from '../repository/decoySession.repository';
import { DecoyAccountRepository } from '../repository/decoyAccount.repository';
import { DecoyAIService } from './decoyAI.service';
import { uploadBufferToS3 } from '../utils/s3.util';
import { emitToSession, emitToUser } from '../socket/emitter';
import { getNotificationService, NotificationService } from './notification.service';
import config from '../config';
import logger from '../utils/logger';

// 20s poll cadence: 4× fewer getMessages calls per session than a 5s poll,
// which is the main lever for fitting more sessions onto one decoy account's
// Telegram rate budget. Detection latency (≤20s) is negligible against the
// 60s–5min adaptive reply delay, so this does not hurt human-likeness.
const POLL_INTERVAL_MS = 20000;
// Transient poll failures (network blips, server errors, flood-waits) should not
// kill a long-running session on a momentary hiccup. We tolerate a generous run
// of them and back the session off before the next attempt. Fatal errors
// (auth/banned/blocked) bypass this budget and pause immediately.
const MAX_CONSECUTIVE_ERRORS = 12;
// After an error-budget pause, attempt one self-heal resume rather than leaving
// the session paused for a human to notice.
const ERROR_PAUSE_SELF_HEAL_MS = 5 * 60 * 1000;

// Telegram RPC error substrings that mean the session is genuinely broken and
// retrying is pointless — pause immediately rather than burning the error budget.
const FATAL_ERROR_PATTERNS = [
  'AUTH_KEY',           // AUTH_KEY_DUPLICATED / _UNREGISTERED / _INVALID
  'USER_DEACTIVATED',
  'SESSION_REVOKED',
  'SESSION_EXPIRED',
  'PHONE_NUMBER_BANNED',
  'USER_BANNED_IN_CHANNEL',
  'PEER_ID_INVALID',    // target no longer resolvable
  'USER_IS_BLOCKED',    // decoy was blocked by the target
  'YOU_BLOCKED_USER',
];

// AUTH_KEY_DUPLICATED is handled by its own dedicated self-heal path on connect,
// so it's classified fatal here only to stop the poll loop quickly — the connect
// retry/self-heal logic owns the actual recovery.

function isFatalError(message: string): boolean {
  if (!message) return false;
  return FATAL_ERROR_PATTERNS.some((p) => message.includes(p));
}

// Returns the number of seconds Telegram asked us to wait, or null if this
// isn't a flood-wait error. Reads the structured `.seconds` from GramJS's
// FloodWaitError, falling back to parsing "FLOOD_WAIT_X" from the message.
function getFloodWaitSeconds(err: any): number | null {
  if (typeof err?.seconds === 'number' && err.seconds >= 0) return err.seconds;
  const m = /FLOOD_WAIT_(\d+)/.exec(err?.message ?? '');
  return m ? parseInt(m[1], 10) : null;
}


// Proportional to message length at ~50 chars/sec, clamped 1.5–8 s
const typingDelay = (text: string): Promise<void> => {
  const base = (text.length / 50) * 1000;
  const ms = Math.min(8000, Math.max(1500, base * (0.8 + Math.random() * 0.4)));
  return new Promise((res) => setTimeout(res, ms));
};

// Short gap between burst message parts (1–3 s)
const burstGap = (): Promise<void> =>
  new Promise((res) => setTimeout(res, 1000 + Math.random() * 2000));

interface MediaInfo {
  mime: string;
  ext: string;
  kind: MediaKind;
}

function maybeMangle(text: string): { mangled: string; original: string } | null {
  if (Math.random() > 0.125 || text.length < 8) return null;
  const words = text.split(' ');
  if (words.length < 2) return null;
  const idx = 1 + Math.floor(Math.random() * (words.length - 1));
  const word = words[idx];
  if (word.length < 3) return null;
  const ci = Math.floor(Math.random() * (word.length - 1));
  const chars = word.split('');
  [chars[ci], chars[ci + 1]] = [chars[ci + 1], chars[ci]];
  words[idx] = chars.join('');
  return { mangled: words.join(' '), original: text };
}

function applyTimeOfDayMultiplier(baseMs: number): number {
  const hour = new Date().getHours();
  let factor = 1;
  if (hour >= 22 || hour < 6) {
    // Late night: 15% chance of a long "sleeping" gap (6–10×), otherwise 2–4×
    factor = Math.random() < 0.15 ? (6 + Math.random() * 4) : (2 + Math.random() * 2);
  } else if (hour >= 6 && hour < 9) {
    factor = 1.2 + Math.random() * 0.5;
  } else if (hour >= 12 && hour < 14) {
    factor = 1.1 + Math.random() * 0.3;
  }
  return Math.min(baseMs * factor, 600_000);
}

function inferMedia(m: any): MediaInfo {
  const cls: string = m.media?.className ?? '';
  if (cls === 'MessageMediaPhoto') {
    return { mime: 'image/jpeg', ext: 'jpg', kind: 'photo' };
  }
  if (cls === 'MessageMediaDocument') {
    const mime: string = m.media?.document?.mimeType ?? 'application/octet-stream';
    const attrs: any[] = m.media?.document?.attributes ?? [];
    const isAnimated = attrs.some((a: any) => a.className === 'DocumentAttributeAnimated');

    if (mime === 'image/gif' || isAnimated) return { mime: 'image/gif', ext: 'gif', kind: 'gif' };
    if (mime === 'image/webp') return { mime: 'image/webp', ext: 'webp', kind: 'sticker' };
    if (mime.startsWith('video/')) {
      const sub = mime.split('/')[1] ?? 'mp4';
      const ext = sub === 'quicktime' ? 'mov' : sub;
      return { mime, ext, kind: 'video' };
    }
    if (mime.startsWith('audio/')) {
      const ext = mime.split('/')[1] ?? 'ogg';
      return { mime, ext, kind: 'audio' };
    }
    return { mime, ext: 'bin', kind: 'document' };
  }
  return { mime: 'application/octet-stream', ext: 'bin', kind: 'unknown' };
}

export class DecoyBotService {
  private clients = new Map<string, TelegramClient>();
  private targetEntities = new Map<string, unknown>();
  private intervals = new Map<string, ReturnType<typeof setInterval>>();
  private consecutiveErrors = new Map<string, number>();
  private pollingActive = new Map<string, boolean>();
  private sessionAccounts = new Map<string, string>();
  private sessionUsers = new Map<string, string>();
  // Shared TelegramClient pool keyed by decoy accountId. One MTProto connection
  // is multiplexed across every session using the same decoy account, so the
  // same StringSession is never opened twice (which would cause AUTH_KEY_DUPLICATED).
  private accountClients = new Map<string, { client: TelegramClient; refCount: number }>();
  private accountConnecting = new Map<string, Promise<TelegramClient>>();
  // Background reply scheduling — one pending reply per session at a time
  private pendingReplies = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingImages = new Map<string, Buffer>();
  private pendingImageKinds = new Map<string, MediaKind>();
  private lastTargetMsgIds = new Map<string, number>();
  private ghostFollowUpTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private onlinePresence = new Map<string, ReturnType<typeof setTimeout>>();
  // One delayed self-heal retry per session after an AUTH_KEY_DUPLICATED pause.
  private authDupRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Epoch ms until which polling is suspended because Telegram returned
  // FLOOD_WAIT. While set, _poll returns early without counting an error.
  private floodWaitUntil = new Map<string, number>();
  // One delayed self-heal retry per session after an error-budget pause.
  private errorPauseRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly notificationService: NotificationService;

  constructor(
    private readonly sessionRepo: DecoySessionRepository,
    private readonly accountRepo: DecoyAccountRepository,
    private readonly decoyAI: DecoyAIService
  ) {
    this.notificationService = getNotificationService();
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Public API
  // ─────────────────────────────────────────────────────────────────────────

  async startSession(sessionId: string): Promise<void> {
    if (!config.DECOY_BOT_ENABLED) {
      logger.warn(
        `[DecoyBot] DECOY_BOT_ENABLED=false — refusing to start session ${sessionId}. ` +
        `The decoy bot is disabled in this environment to avoid AUTH_KEY_DUPLICATED ` +
        `conflicts with the live server sharing the same session strings.`
      );
      return;
    }
    if (this.intervals.has(sessionId)) {
      logger.warn(`[DecoyBot] startSession called for already-running session ${sessionId}`);
      return;
    }

    const session = await this.sessionRepo.findById(sessionId);
    if (!session) {
      logger.error(`[DecoyBot] startSession: session ${sessionId} not found`);
      return;
    }
    if (session.status !== 'active') {
      logger.warn(`[DecoyBot] startSession: session ${sessionId} is '${session.status}', skipping`);
      return;
    }

    const account = await this.accountRepo.findById(session.decoyAccountId.toString());
    if (!account) {
      logger.error(`[DecoyBot] startSession: decoy account not found for session ${sessionId}`);
      await this.stopSession(sessionId, 'paused', 'Decoy account not found');
      return;
    }

    try {
      const client = await this._acquireClient(account);
      this.clients.set(sessionId, client);
      this.sessionAccounts.set(sessionId, account._id.toString());
      this.sessionUsers.set(sessionId, session.userId.toString());

      const entity = await client.getEntity(session.targetIdentifier);
      this.targetEntities.set(sessionId, entity);

      await this.accountRepo.lockAccount(account._id.toString(), sessionId);

      const entityId = (entity as any).id?.toString();
      if (entityId && !session.targetTelegramUserId) {
        await this.sessionRepo.updateTargetUserId(sessionId, entityId);
      }

      const isNewSession = !session.lastProcessedMsgId && !session.messages?.length;

      if (!session.lastProcessedMsgId) {
        await this._initialiseWatermark(sessionId, client, entity);
      }

      if (isNewSession) {
        await this._sendOpener(sessionId, client, entity, session.systemPrompt);
      }

      this.consecutiveErrors.set(sessionId, 0);
      this.pollingActive.set(sessionId, false);

      const interval = setInterval(() => {
        this._poll(sessionId).catch((err) =>
          logger.error(`[DecoyBot] Unhandled poll error for session ${sessionId}:`, err)
        );
      }, POLL_INTERVAL_MS);

      this.intervals.set(sessionId, interval);
      logger.info(`[DecoyBot] Session ${sessionId} started (target=${session.targetIdentifier})`);
    } catch (err: any) {
      logger.error(`[DecoyBot] Failed to start session ${sessionId}:`, err.message);
      await this.stopSession(sessionId, 'paused', err.message);

      // Self-heal: AUTH_KEY_DUPLICATED after a hard crash means the previous
      // process's connection is still lingering on Telegram's side. It clears
      // within a few minutes, so schedule ONE delayed resume rather than
      // leaving the session paused for a human to click. Only one timer per
      // session — a second failure will not stack retries.
      const isAuthDup = err?.message?.includes('AUTH_KEY_DUPLICATED');
      if (isAuthDup && config.DECOY_BOT_ENABLED && !this.authDupRetryTimers.has(sessionId)) {
        const RETRY_AFTER_MS = 5 * 60 * 1000;
        logger.warn(
          `[DecoyBot] Session ${sessionId} hit AUTH_KEY_DUPLICATED — ` +
          `scheduling one self-heal resume in ${RETRY_AFTER_MS / 60000} min`
        );
        const timer = setTimeout(() => {
          this.authDupRetryTimers.delete(sessionId);
          this.resumeSession(sessionId).catch((e) =>
            logger.error(`[DecoyBot] Self-heal resume failed for ${sessionId}:`, e)
          );
        }, RETRY_AFTER_MS);
        this.authDupRetryTimers.set(sessionId, timer);
      }
    }
  }

  async stopSession(
    sessionId: string,
    newStatus: 'paused' | 'stopped' = 'paused',
    reason?: string
  ): Promise<void> {
    this._clearInterval(sessionId);

    const pending = this.pendingReplies.get(sessionId);
    if (pending) {
      clearTimeout(pending);
      this.pendingReplies.delete(sessionId);
    }
    this.pendingImages.delete(sessionId);
    this.pendingImageKinds.delete(sessionId);
    this.lastTargetMsgIds.delete(sessionId);
    this._cancelGhostFollowUp(sessionId);

    // Cancel any pending self-heal retry. In the AUTH_KEY_DUPLICATED path the
    // catch block re-arms this timer *after* stopSession returns, so clearing
    // here only kills retries from manual stops/resumes — exactly what we want.
    const authDupTimer = this.authDupRetryTimers.get(sessionId);
    if (authDupTimer) {
      clearTimeout(authDupTimer);
      this.authDupRetryTimers.delete(sessionId);
    }

    // Cancel any pending error-budget self-heal retry. As with the auth-dup
    // timer, the catch block re-arms this *after* stopSession returns, so
    // clearing here only kills retries from manual stops/resumes.
    const errorPauseTimer = this.errorPauseRetryTimers.get(sessionId);
    if (errorPauseTimer) {
      clearTimeout(errorPauseTimer);
      this.errorPauseRetryTimers.delete(sessionId);
    }
    this.floodWaitUntil.delete(sessionId);

    const offlineTimer = this.onlinePresence.get(sessionId);
    if (offlineTimer) {
      clearTimeout(offlineTimer);
      this.onlinePresence.delete(sessionId);
    }

    this.clients.delete(sessionId);
    this.targetEntities.delete(sessionId);
    this.consecutiveErrors.delete(sessionId);
    this.pollingActive.delete(sessionId);

    const accountId = this.sessionAccounts.get(sessionId);
    this.sessionAccounts.delete(sessionId);
    this.sessionUsers.delete(sessionId);

    if (accountId) {
      await this._releaseClient(accountId);
    }

    await this.sessionRepo.updateStatus(sessionId, newStatus);

    if (accountId) {
      await this.accountRepo.releaseAccount(accountId, sessionId);
    } else {
      const session = await this.sessionRepo.findById(sessionId);
      if (session?.decoyAccountId) {
        await this.accountRepo.releaseAccount(session.decoyAccountId.toString(), sessionId);
      }
    }

    logger.info(`[DecoyBot] Session ${sessionId} → ${newStatus}${reason ? ` (${reason})` : ''}`);
    emitToSession(sessionId, 'decoy:status', reason ? { status: newStatus, reason } : { status: newStatus });

    // Persist status-change notification
    const statusUserId = this.sessionUsers.get(sessionId);
    if (statusUserId) {
      this.notificationService.notify({
        userId: statusUserId,
        sessionId,
        type: 'status_change',
        title: `Session ${newStatus}`,
        body: reason || `Session has been ${newStatus}.`,
        metadata: { status: newStatus, reason },
      });
    }
  }

  async resumeSession(sessionId: string): Promise<void> {
    await this.sessionRepo.updateStatus(sessionId, 'active');
    await this.startSession(sessionId);
  }

  async sendManualMessage(sessionId: string, text: string): Promise<IDecoyMessage> {
    if (!config.DECOY_BOT_ENABLED) {
      throw new Error('Decoy bot is disabled in this environment (DECOY_BOT_ENABLED=false)');
    }
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) throw new Error('Session not found');

    let client = this.clients.get(sessionId);
    let tempAccountId: string | null = null;

    if (!client) {
      const account = await this.accountRepo.findById(session.decoyAccountId.toString());
      if (!account) throw new Error('Decoy account not found');
      client = await this._acquireClient(account);
      tempAccountId = account._id.toString();
    }

    try {
      let entity = this.targetEntities.get(sessionId);
      if (!entity) {
        entity = await client.getEntity(session.targetIdentifier);
        if (!tempAccountId) this.targetEntities.set(sessionId, entity);
      }

      await (client as any).sendMessage(entity, { message: text });

      // Advance watermark so the bot doesn't treat this outgoing message as incoming
      try {
        const latest: any[] = await (client as any).getMessages(entity, { limit: 1 });
        if (latest[0]?.id) {
          await this.sessionRepo.updatePollingState(sessionId, {
            lastPolledAt: new Date(),
            lastProcessedMsgId: latest[0].id,
          });
        }
      } catch { /* best-effort */ }

      const msg: IDecoyMessage = { role: 'manual', content: text, timestamp: new Date() };
      await this.sessionRepo.appendMessages(sessionId, [msg]);
      emitToSession(sessionId, 'decoy:message', msg);
      return msg;
    } finally {
      if (tempAccountId) {
        await this._releaseClient(tempAccountId);
      }
    }
  }

  async resumeActiveSessions(): Promise<void> {
    const activeSessions = await this.sessionRepo.findActiveSessions();
    if (!activeSessions.length) return;

    logger.info(`[DecoyBot] Resuming ${activeSessions.length} active session(s)`);
    await Promise.allSettled(
      activeSessions.map((s) => this.startSession(s._id.toString()))
    );
  }

  async stopAllSessions(newStatus: 'paused' | 'stopped' = 'paused'): Promise<void> {
    const sessionIds = Array.from(this.intervals.keys());
    if (!sessionIds.length) return;

    logger.info(`[DecoyBot] Stopping all ${sessionIds.length} session(s) [${newStatus}]`);
    await Promise.allSettled(sessionIds.map((id) => this.stopSession(id, newStatus)));
  }

  // Synchronous best-effort disconnect — safe to call from process 'exit' event.
  disconnectAllClients(): void {
    for (const [, entry] of this.accountClients) {
      try { entry.client.disconnect(); } catch { /* ignore */ }
    }
    this.accountClients.clear();
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Polling core
  // ─────────────────────────────────────────────────────────────────────────

  // Fast poll: detect new messages, save+emit them immediately, schedule reply
  // in background. pollingActive is released as soon as the DB writes are done —
  // the reply timer runs independently so the loop keeps ticking normally.
  private async _poll(sessionId: string): Promise<void> {
    if (this.pollingActive.get(sessionId)) return;

    // Respect any active flood-wait window — skip this tick without touching the
    // error budget. Telegram penalises continued requests during a flood-wait,
    // so backing off here is what actually lets the session recover.
    const waitUntil = this.floodWaitUntil.get(sessionId);
    if (waitUntil && Date.now() < waitUntil) return;
    if (waitUntil) this.floodWaitUntil.delete(sessionId);

    this.pollingActive.set(sessionId, true);

    try {
      const snapshot = await this.sessionRepo.findForPolling(sessionId);
      if (!snapshot || snapshot.status !== 'active') {
        this._clearInterval(sessionId);
        return;
      }

      const client = this.clients.get(sessionId);
      const entity = this.targetEntities.get(sessionId);
      if (!client || !entity) return;

      const originalWatermark = snapshot.lastProcessedMsgId ?? 0;

      const precheck: any[] = await (client as any).getMessages(entity, {
        limit: 5,
        minId: originalWatermark,
      });

      const isIncoming = (m: any) =>
        !m.out && (
          (typeof m.text === 'string' && m.text.trim().length > 0) ||
          m.media != null
        );

      if (!precheck.some(isIncoming)) {
        if (precheck.length) {
          const maxId = Math.max(...precheck.map((m) => m.id));
          await this.sessionRepo.updatePollingState(sessionId, {
            lastPolledAt: new Date(),
            lastProcessedMsgId: maxId,
          });
        }
        return;
      }

      const allNew: any[] = await (client as any).getMessages(entity, {
        limit: 20,
        minId: originalWatermark,
      });
      if (!allNew.length) return;

      const sorted = [...allNew].sort((a, b) => a.id - b.id);
      const newWatermark: number = sorted[sorted.length - 1].id;
      const incoming = sorted.filter(isIncoming);

      if (!incoming.length) {
        await this.sessionRepo.updatePollingState(sessionId, {
          lastPolledAt: new Date(),
          lastProcessedMsgId: newWatermark,
        });
        return;
      }

      // Download media and upload to S3 for immediate display
      const mediaBufMap = new Map<number, Buffer>();
      const mediaUrlMap = new Map<number, string>();
      const mediaKindMap = new Map<number, MediaKind>();
      const mediaMimeMap = new Map<number, string>();
      for (const m of incoming) {
        if (m.media) {
          try {
            const info = inferMedia(m);
            const buf = await (client as any).downloadMedia(m, {}) as Buffer | undefined;
            if (buf?.length) {
              mediaBufMap.set(m.id, buf);
              const s3Key = `decoy-media/${sessionId}/${m.id}.${info.ext}`;
              const url = await uploadBufferToS3(s3Key, buf, info.mime);
              mediaUrlMap.set(m.id, url);
              mediaKindMap.set(m.id, info.kind);
              mediaMimeMap.set(m.id, info.mime);
              logger.info(`[DecoyBot] media msg=${m.id} kind=${info.kind} mime=${info.mime}`);
            }
          } catch (err: any) {
            logger.warn(`[DecoyBot] Media download failed msg=${m.id}: ${err.message}`);
          }
        }
      }

      // Persist and emit target messages RIGHT NOW — no waiting for the AI reply
      const targetMessages: IDecoyMessage[] = incoming.map((m: any) => ({
        role: 'target' as const,
        content: (typeof m.text === 'string' && m.text.trim()) ? m.text.trim() : '[Image]',
        mediaUrl: mediaUrlMap.get(m.id) ?? null,
        mediaKind: mediaKindMap.get(m.id) ?? null,
        mediaMime: mediaMimeMap.get(m.id) ?? null,
        timestamp: new Date((m.date as number) * 1000),
      }));

      await this.sessionRepo.appendMessages(sessionId, targetMessages);
      await this.sessionRepo.updatePollingState(sessionId, {
        lastPolledAt: new Date(),
        lastProcessedMsgId: newWatermark,
      });
      await this.sessionRepo.incrementUnseenCount(sessionId, targetMessages.length);
      for (const msg of targetMessages) {
        emitToSession(sessionId, 'decoy:message', msg);
      }

      const userId = this.sessionUsers.get(sessionId);
      if (userId) {
        const lastContent = targetMessages[targetMessages.length - 1]?.content?.slice(0, 100) || '';
        this.notificationService.notify({
          userId,
          sessionId,
          type: 'new_message',
          title: 'New message from target',
          body: lastContent,
          metadata: {
            unseenCount: (snapshot.unseenCount ?? 0) + targetMessages.length,
            messageCount: targetMessages.length,
            direction: 'inbound',
          },
        });
      }

      // Mark as read with a natural delay (3–20 s)
      this._markRead(client, entity, newWatermark);

      // Target replied — cancel any pending ghost follow-up
      this._cancelGhostFollowUp(sessionId);

      // Track the last inbound message ID for reply-to threading
      const lastInbound = sorted.filter((m: any) => !m.out).pop();
      if (lastInbound) this.lastTargetMsgIds.set(sessionId, lastInbound.id);

      // Always capture the first image from this poll, even if a reply is already
      // pending — the existing timer will call _doReply which reads pendingImages.
      if (!this.pendingImages.has(sessionId)) {
        const firstImg = incoming.find((m: any) => mediaBufMap.has(m.id));
        if (firstImg) {
          this.pendingImages.set(sessionId, mediaBufMap.get(firstImg.id)!);
          this.pendingImageKinds.set(sessionId, mediaKindMap.get(firstImg.id) ?? 'photo');
        }
      }

      // If a reply is already scheduled (target sent multiple messages quickly),
      // leave the existing timer running — _doReply fetches fresh context from DB
      // so it will naturally include these new messages.
      if (!this.pendingReplies.has(sessionId)) {
        const delayMs = applyTimeOfDayMultiplier(
          this._computeAdaptiveDelay([...(snapshot.messages as IDecoyMessage[]), ...targetMessages])
        );
        const timer = setTimeout(() => {
          this.pendingReplies.delete(sessionId);
          this._doReply(sessionId).catch((err) =>
            logger.error(`[DecoyBot] _doReply error session=${sessionId}:`, err)
          );
        }, delayMs);
        this.pendingReplies.set(sessionId, timer);
        logger.info(`[DecoyBot] Reply scheduled in ${Math.round(delayMs / 1000)}s for session ${sessionId}`);
      }

      this.consecutiveErrors.set(sessionId, 0);

    } catch (err: any) {
      const message: string = err?.message ?? String(err);

      // 1) Flood-wait: Telegram told us exactly how long to back off. Suspend
      //    polling for that window (plus a small jitter) and DON'T count it as a
      //    failure — hammering during a flood-wait only extends the penalty.
      const floodSeconds = getFloodWaitSeconds(err);
      if (floodSeconds != null) {
        const jitterMs = Math.floor(Math.random() * 3000);
        const waitMs = floodSeconds * 1000 + jitterMs;
        this.floodWaitUntil.set(sessionId, Date.now() + waitMs);
        logger.warn(
          `[DecoyBot] Session ${sessionId} hit FLOOD_WAIT — suspending polling for ${floodSeconds}s`
        );
        return;
      }

      // 2) Fatal: auth/banned/blocked/unresolvable. No point retrying — pause now.
      if (isFatalError(message)) {
        logger.error(`[DecoyBot] Session ${sessionId} hit fatal poll error — auto-pausing: ${message}`);
        await this.stopSession(sessionId, 'paused', `Auto-paused: ${message}`);
        return;
      }

      // 3) Transient (network blip, ServerError/-503, timeout): count it against
      //    a generous budget. Each consecutive failure backs the next attempt off
      //    exponentially (capped) so a brief outage can't burn the budget in 15s.
      const errorCount = (this.consecutiveErrors.get(sessionId) ?? 0) + 1;
      this.consecutiveErrors.set(sessionId, errorCount);

      const backoffMs = Math.min(5 * 60 * 1000, POLL_INTERVAL_MS * 2 ** Math.min(errorCount, 6));
      this.floodWaitUntil.set(sessionId, Date.now() + backoffMs);

      logger.error(
        `[DecoyBot] Transient poll error (${errorCount}/${MAX_CONSECUTIVE_ERRORS}) ` +
        `session=${sessionId}, backing off ${Math.round(backoffMs / 1000)}s: ${message}`
      );

      if (errorCount >= MAX_CONSECUTIVE_ERRORS) {
        logger.error(`[DecoyBot] Session ${sessionId} exceeded error budget — auto-pausing`);
        await this.stopSession(sessionId, 'paused', 'Auto-paused: too many consecutive errors');
        this._scheduleErrorPauseSelfHeal(sessionId);
      }
    } finally {
      this.pollingActive.set(sessionId, false);
    }
  }

  // Runs after the adaptive delay. Fetches fresh context so any messages the
  // target sent during the wait window are included in the reply.
  private async _doReply(sessionId: string): Promise<void> {
    const status = await this.sessionRepo.findStatus(sessionId);
    if (!status || status.status !== 'active') return;

    const client = this.clients.get(sessionId);
    const entity = this.targetEntities.get(sessionId);
    if (!client || !entity) return;

    // Cancel any scheduled offline transition — we're about to actively reply
    const offlineTimer = this.onlinePresence.get(sessionId);
    if (offlineTimer) {
      clearTimeout(offlineTimer);
      this.onlinePresence.delete(sessionId);
    }
    this._goOnlineNow(client);

    const snapshot = await this.sessionRepo.findForPolling(sessionId);
    if (!snapshot) return;

    const history = snapshot.messages as IDecoyMessage[];
    const steering = {
      objective: snapshot.standingObjective || '',
      nudge: snapshot.pendingNudge || '',
    };

    // Find unresponded target messages (everything after the last ai/manual message)
    const lastBotIdx = [...history].reverse().findIndex(
      (m) => m.role === 'ai' || m.role === 'manual'
    );
    const since = lastBotIdx === -1 ? history : history.slice(history.length - lastBotIdx);
    const pendingTarget = since.filter((m) => m.role === 'target');

    if (!pendingTarget.length) return;

    const imageBuf = this.pendingImages.get(sessionId);
    const imageKind = this.pendingImageKinds.get(sessionId);
    this.pendingImages.delete(sessionId);
    this.pendingImageKinds.delete(sessionId);

    const combinedInput = pendingTarget
      .map((m) => {
        if (m.mediaUrl) {
          const k = m.mediaKind;
          if (k === 'video') return '[target sent a video]';
          if (k === 'audio') return '[target sent a voice message]';
          if (k === 'document') return '[target sent a file]';
          if (k === 'sticker') return '[target sent a sticker]';
          return m.content !== '[Image]' ? `${m.content} [image attached]` : '[Image]';
        }
        return m.content;
      })
      .filter(Boolean)
      .join('\n');

    if (!combinedInput) return;

    const stopTyping = this._startTypingLoop(client, entity);
    let parts: string[];
    try {
      const useVision = !!imageBuf && (imageKind === 'photo' || imageKind === 'gif' || !imageKind);
      logger.info(`[DecoyBot] _doReply session=${sessionId} useVision=${useVision} bufLen=${imageBuf?.length ?? 0} kind=${imageKind ?? 'none'} pending=${pendingTarget.length}`);
      if (useVision) {
        // Pass history UP TO but not including the pending batch. The pending messages
        // (including the photo placeholder) are represented by the vision image_url content
        // below — passing them in history too creates a duplicate signal that makes GPT-4o
        // believe image viewing is broken in this conversation.
        const historyForVision = history.slice(0, history.length - pendingTarget.length);
        // Caption = any text the target wrote alongside the photo
        const visionCaption = pendingTarget
          .filter((m) => m.content && m.content !== '[Image]')
          .map((m) => m.content)
          .join('\n')
          .trim() || undefined;
        // Ensure proper Node.js Buffer before base64 encoding (GramJS may return Uint8Array)
        const imageBase64 = Buffer.from(imageBuf!).toString('base64');
        logger.info(`[DecoyBot] Vision call: base64Len=${imageBase64.length} caption="${visionCaption ?? '(none)'}"`);
        parts = await this.decoyAI.generateReplyWithImage(
          snapshot.systemPrompt, historyForVision, imageBase64, visionCaption, steering
        );
      } else {
        parts = await this.decoyAI.generateReply(snapshot.systemPrompt, history, combinedInput, steering);
      }
    } finally {
      stopTyping();
    }

    const replyToId = this.lastTargetMsgIds.get(sessionId);
    const aiMessages: IDecoyMessage[] = [];
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        await burstGap();
        const resume = this._startTypingLoop(client, entity);
        await typingDelay(parts[i]);
        resume();
        await (client as any).sendMessage(entity, { message: parts[i] });
        aiMessages.push({ role: 'ai', content: parts[i], timestamp: new Date() });
      } else {
        await typingDelay(parts[i]);
        const typo = maybeMangle(parts[i]);
        const sendOpts = replyToId ? { replyTo: replyToId } : {};
        if (typo) {
          await (client as any).sendMessage(entity, { message: typo.mangled, ...sendOpts });
          // Self-correct 2–5 s later, like a real person catching a typo
          const fixDelay = 2000 + Math.random() * 3000;
          setTimeout(async () => {
            try {
              const sentMsgs: any[] = await (client as any).getMessages(entity, { limit: 1 });
              if (sentMsgs[0]) {
                await (client as any).invoke(
                  new Api.messages.EditMessage({
                    peer: entity as any,
                    id: sentMsgs[0].id,
                    message: typo.original,
                  })
                );
              }
            } catch { /* cosmetic — ignore */ }
          }, fixDelay);
          aiMessages.push({ role: 'ai', content: typo.original, timestamp: new Date() });
        } else {
          await (client as any).sendMessage(entity, { message: parts[i], ...sendOpts });
          aiMessages.push({ role: 'ai', content: parts[i], timestamp: new Date() });
        }
      }
    }

    await this.sessionRepo.appendMessages(sessionId, aiMessages);
    if (steering.nudge) {
      await this.sessionRepo.clearNudge(sessionId);
    }
    for (const msg of aiMessages) {
      emitToSession(sessionId, 'decoy:message', msg);
    }

    // Notify operator that the decoy replied (outbound message notification)
    const replyUserId = this.sessionUsers.get(sessionId);
    if (replyUserId) {
      const lastAiContent = aiMessages[aiMessages.length - 1]?.content?.slice(0, 100) || '';
      this.notificationService.notify({
        userId: replyUserId,
        sessionId,
        type: 'new_message',
        title: 'Your decoy sent a reply',
        body: lastAiContent,
        metadata: {
          messageCount: aiMessages.length,
          direction: 'outbound',
        },
      });
    }

    // If target doesn't reply in 4 h, send a natural follow-up
    this._scheduleGhostFollowUp(sessionId);

    // Go offline 30–90 s after finishing the reply
    this._goOfflineSoon(client, sessionId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Helpers
  // ─────────────────────────────────────────────────────────────────────────

  // Compute how long the bot should wait before replying.
  // Uses the 3 most recent target-message gaps so it adapts quickly to pace changes.
  // Falls back to 90–180 s when there is not enough history.
  private _computeAdaptiveDelay(history: IDecoyMessage[]): number {
    // last 4 messages → up to 3 gaps
    const targetMsgs = history.filter((m) => m.role === 'target').slice(-4);

    if (targetMsgs.length < 2) {
      return 90_000 + Math.random() * 90_000;
    }

    const gaps: number[] = [];
    for (let i = 1; i < targetMsgs.length; i++) {
      const gap =
        new Date(targetMsgs[i].timestamp).getTime() -
        new Date(targetMsgs[i - 1].timestamp).getTime();
      if (gap > 0 && gap < 3_600_000) gaps.push(gap);
    }

    if (!gaps.length) return 90_000 + Math.random() * 90_000;

    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    // Reply at 60–120 % of the target's recent pace, clamped 60 s–5 min
    const ms = Math.min(300_000, Math.max(60_000, avgGap * (0.6 + Math.random() * 0.6)));
    logger.debug(`[DecoyBot] Adaptive delay: avgGap=${Math.round(avgGap / 1000)}s → wait=${Math.round(ms / 1000)}s`);
    return ms;
  }

  // Sends a typing action immediately and keeps refreshing every 4.5 s.
  // Telegram's typing indicator expires after ~5 s without a refresh.
  // Returns a stop function — call it when the message is about to be sent.
  private _startTypingLoop(client: TelegramClient, entity: unknown): () => void {
    const send = () => {
      (client as any).invoke(
        new Api.messages.SetTyping({
          peer: entity as any,
          action: new Api.SendMessageTypingAction(),
        })
      ).catch(() => { /* ignore — typing indicator is cosmetic */ });
    };

    send();
    const interval = setInterval(send, 4500);
    return () => clearInterval(interval);
  }

  private async _sendOpener(
    sessionId: string,
    client: TelegramClient,
    entity: unknown,
    systemPrompt: string
  ): Promise<void> {
    try {
      const parts = await this.decoyAI.generateOpener(systemPrompt);

      for (let i = 0; i < parts.length; i++) {
        if (i > 0) await burstGap();
        const stopTyping = this._startTypingLoop(client, entity);
        await typingDelay(parts[i]);
        stopTyping();
        await (client as any).sendMessage(entity, { message: parts[i] });

        const msg: IDecoyMessage = { role: 'ai', content: parts[i], timestamp: new Date() };
        await this.sessionRepo.appendMessages(sessionId, [msg]);
        emitToSession(sessionId, 'decoy:message', msg);
      }

      logger.info(`[DecoyBot] Opener sent (${parts.length} part(s)) for session ${sessionId}`);
    } catch (err: any) {
      logger.error(`[DecoyBot] Failed to send opener for session ${sessionId}:`, err.message);
    }
  }

  private async _connectClient(account: IDecoyTelegramAccount): Promise<TelegramClient> {
    const client = new TelegramClient(
      new StringSession(account.sessionString),
      account.apiId,
      account.apiHash,
      { connectionRetries: 5 }
    );
    (client as any).setLogLevel('none');
    await client.connect();
    return client;
  }

  // Acquire the shared client for this decoy account, creating one if needed.
  // Concurrent acquires for the same account dedupe through accountConnecting.
  // AUTH_KEY_DUPLICATED (happens when a previous process didn't disconnect
  // cleanly on restart) is retried with backoff — Telegram releases the old
  // key within seconds once it detects the previous connection dropped.
  private async _acquireClient(account: IDecoyTelegramAccount): Promise<TelegramClient> {
    const accountId = account._id.toString();
    const existing = this.accountClients.get(accountId);
    if (existing) {
      existing.refCount += 1;
      return existing.client;
    }

    let inflight = this.accountConnecting.get(accountId);
    if (!inflight) {
      inflight = (async () => {
        const RETRY_DELAYS = [15_000, 30_000, 60_000, 90_000]; // 4 attempts; Telegram keepalive can take 60-120s
        for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
          try {
            const client = await this._connectClient(account);
            this.accountClients.set(accountId, { client, refCount: 0 });
            return client;
          } catch (err: any) {
            const isDuplicate = err?.message?.includes('AUTH_KEY_DUPLICATED');
            if (isDuplicate && attempt < RETRY_DELAYS.length) {
              const delay = RETRY_DELAYS[attempt];
              logger.warn(
                `[DecoyBot] AUTH_KEY_DUPLICATED for account ${accountId} — ` +
                `retrying in ${delay / 1000}s (attempt ${attempt + 1}/${RETRY_DELAYS.length})`
              );
              await new Promise((res) => setTimeout(res, delay));
            } else {
              throw err;
            }
          }
        }
        throw new Error('Failed to connect: AUTH_KEY_DUPLICATED persists after retries');
      })();
      this.accountConnecting.set(accountId, inflight);
    }

    try {
      const client = await inflight;
      const entry = this.accountClients.get(accountId);
      if (entry) entry.refCount += 1;
      return client;
    } finally {
      this.accountConnecting.delete(accountId);
    }
  }

  private async _releaseClient(accountId: string): Promise<void> {
    const entry = this.accountClients.get(accountId);
    if (!entry) return;
    entry.refCount -= 1;
    if (entry.refCount <= 0) {
      this.accountClients.delete(accountId);
      try { await entry.client.disconnect(); } catch { /* ignore */ }
    }
  }

  private async _initialiseWatermark(
    sessionId: string,
    client: TelegramClient,
    entity: unknown
  ): Promise<void> {
    try {
      const latest: any[] = await (client as any).getMessages(entity, { limit: 1 });
      const watermark = latest[0]?.id ?? 0;
      await this.sessionRepo.updatePollingState(sessionId, {
        lastPolledAt: new Date(),
        lastProcessedMsgId: watermark,
      });
      logger.info(`[DecoyBot] Session ${sessionId} watermark initialised at msgId=${watermark}`);
    } catch {
      // Non-fatal — watermark stays 0
    }
  }

  private _goOnlineNow(client: TelegramClient): void {
    (client as any).invoke(new Api.account.UpdateStatus({ offline: false }))
      .catch(() => { /* cosmetic */ });
  }

  private _goOfflineSoon(client: TelegramClient, sessionId: string): void {
    const existing = this.onlinePresence.get(sessionId);
    if (existing) clearTimeout(existing);
    const delay = 30_000 + Math.random() * 60_000; // 30–90 s
    const timer = setTimeout(() => {
      this.onlinePresence.delete(sessionId);
      (client as any).invoke(new Api.account.UpdateStatus({ offline: true }))
        .catch(() => { /* cosmetic */ });
    }, delay);
    this.onlinePresence.set(sessionId, timer);
  }

  private _scheduleGhostFollowUp(sessionId: string): void {
    const existing = this.ghostFollowUpTimers.get(sessionId);
    if (existing) clearTimeout(existing);

    const FOUR_HOURS = 4 * 60 * 60 * 1000;
    const timer = setTimeout(async () => {
      this.ghostFollowUpTimers.delete(sessionId);
      try {
        const status = await this.sessionRepo.findStatus(sessionId);
        if (!status || status.status !== 'active') return;

        const snapshot = await this.sessionRepo.findForPolling(sessionId);
        if (!snapshot) return;

        const history = snapshot.messages as IDecoyMessage[];
        const lastMsg = history[history.length - 1];
        // Only follow up if we sent the last message (target hasn't replied yet)
        if (!lastMsg || lastMsg.role === 'target') return;

        const client = this.clients.get(sessionId);
        const entity = this.targetEntities.get(sessionId);
        if (!client || !entity) return;

        const parts = await this.decoyAI.generateFollowUp(snapshot.systemPrompt, history, {
          objective: snapshot.standingObjective || '',
        });
        const stopTyping = this._startTypingLoop(client, entity);
        const followUpMsgs: IDecoyMessage[] = [];
        try {
          for (let i = 0; i < parts.length; i++) {
            if (i > 0) await burstGap();
            await typingDelay(parts[i]);
            await (client as any).sendMessage(entity, { message: parts[i] });
            followUpMsgs.push({ role: 'ai', content: parts[i], timestamp: new Date() });
          }
        } finally {
          stopTyping();
        }
        await this.sessionRepo.appendMessages(sessionId, followUpMsgs);
        for (const msg of followUpMsgs) emitToSession(sessionId, 'decoy:message', msg);

        // Schedule another follow-up in case they still don't reply
        this._scheduleGhostFollowUp(sessionId);
      } catch (err: any) {
        logger.error(`[DecoyBot] Ghost follow-up error session=${sessionId}:`, err.message);
      }
    }, FOUR_HOURS);

    this.ghostFollowUpTimers.set(sessionId, timer);
  }

  // After an error-budget pause, schedule ONE delayed resume so a transient
  // outage that outlasted the budget doesn't leave the session paused for a
  // human to notice. stopSession clears this timer on any manual stop/resume,
  // and we re-arm it here *after* stopSession has returned. Only one per session.
  private _scheduleErrorPauseSelfHeal(sessionId: string): void {
    if (!config.DECOY_BOT_ENABLED) return;
    if (this.errorPauseRetryTimers.has(sessionId)) return;

    logger.warn(
      `[DecoyBot] Session ${sessionId} error-paused — scheduling one self-heal resume ` +
      `in ${ERROR_PAUSE_SELF_HEAL_MS / 60000} min`
    );
    const timer = setTimeout(() => {
      this.errorPauseRetryTimers.delete(sessionId);
      this.resumeSession(sessionId).catch((e) =>
        logger.error(`[DecoyBot] Error-pause self-heal resume failed for ${sessionId}:`, e)
      );
    }, ERROR_PAUSE_SELF_HEAL_MS);
    this.errorPauseRetryTimers.set(sessionId, timer);
  }

  private _cancelGhostFollowUp(sessionId: string): void {
    const t = this.ghostFollowUpTimers.get(sessionId);
    if (t) {
      clearTimeout(t);
      this.ghostFollowUpTimers.delete(sessionId);
    }
  }

  private _clearInterval(sessionId: string): void {
    const existing = this.intervals.get(sessionId);
    if (existing) {
      clearInterval(existing);
      this.intervals.delete(sessionId);
    }
  }

  // Mark the target's messages as read with a natural delay so the decoy
  // account doesn't appear to read instantly (robotic tell).
  private _markRead(client: TelegramClient, entity: unknown, maxId: number): void {
    const delay = 3000 + Math.random() * 17000;
    setTimeout(() => {
      (client as any).invoke(
        new Api.messages.ReadHistory({ peer: entity as any, maxId })
      ).catch(() => { /* cosmetic — ignore */ });
    }, delay);
  }
}
