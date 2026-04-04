import { Request, Response, NextFunction } from 'express';
import { BkpschAutomation } from '../automation/bkpsch.automation';
import { UserRepository } from '../repository/user.repository';
import { Mutex } from '../utils/mutex';
import { PaymentRequired } from '../errors/payment-required.error';
import logger from '../utils/logger';

const userRepository = new UserRepository();
const bkpschMutex = new Mutex();
const CONNECTED_USERS_CREDIT_COST = 20;

type NearbyFlowResult = {
  result: string;
  csvData: string | null;
  timestamp: string;
  profileText: string | null;
};

type ParsedConnectedUser = {
  title: string;
  username: string;
  link: string;
  id: string | number;
  date_updated: string;
};

const isPlaceholderGroupTitle = (value: string): boolean => {
  return /^group\s*\d+$/i.test(String(value || '').trim());
};

const splitCsvLine = (line: string): string[] => {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells.map((cell) => cell.replace(/(^"|"$)/g, '').trim());
};

const normalizeHeader = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[-_./]/g, '');
};

const findHeaderIndex = (header: string[], candidates: string[]): number => {
  for (const candidate of candidates) {
    const idx = header.findIndex((col) => col === candidate);
    if (idx >= 0) return idx;
  }
  return -1;
};

const extractTelegramUsername = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const text = String(value).trim();

  const fromUrl = text.match(/(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([a-zA-Z0-9_]{3,})/i)?.[1];
  if (fromUrl) return fromUrl;

  const direct = text.match(/^@?([a-zA-Z0-9_]{3,})$/)?.[1];
  if (direct) return direct;

  return null;
};

const normalizeDate = (value: string | null | undefined, fallback: string): string => {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }
  return fallback;
};

const parseConnectedUsersFromNearbyResult = (
  nearbyResult: NearbyFlowResult,
): ParsedConnectedUser[] => {
  const fallbackTimestamp = nearbyResult.timestamp || new Date().toISOString();
  const rawCsv = nearbyResult.csvData || '';

  if (!rawCsv.trim()) {
    return [];
  }

  const lines = rawCsv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    return [];
  }

  const rows = lines.map(splitCsvLine);
  const header = rows[0].map(normalizeHeader);
  const dataRows = rows.slice(1);

  const entityIdIdx = findHeaderIndex(header, ['entityid']);
  const entityTypeIdx = findHeaderIndex(header, ['entitytype']);
  const personNameIdx = findHeaderIndex(header, ['personname']);
  const aliasIdx = findHeaderIndex(header, ['affiliationalias']);
  const profileUrlIdx = findHeaderIndex(header, ['affiliationprofileurl']);
  const uidIdx = findHeaderIndex(header, ['affiliationuid']);
  const sourceIdIdx = findHeaderIndex(header, ['sourceentityid']);
  const targetIdIdx = findHeaderIndex(header, ['targetentityid']);
  const linkTypeIdx = findHeaderIndex(header, ['maltegolinkmanualtype']);

  const entityById = new Map<string, string[]>();
  const relationRows: string[][] = [];

  for (const row of dataRows) {
    const entityId = entityIdIdx >= 0 ? (row[entityIdIdx] || '').trim() : '';
    const sourceId = sourceIdIdx >= 0 ? (row[sourceIdIdx] || '').trim() : '';
    const targetId = targetIdIdx >= 0 ? (row[targetIdIdx] || '').trim() : '';

    if (entityId) {
      entityById.set(entityId, row);
    }

    if (sourceId && targetId) {
      relationRows.push(row);
    }
  }

  const buildEntryFromEntity = (entityRow: string[]): ParsedConnectedUser | null => {
    const entityType = (entityTypeIdx >= 0 ? entityRow[entityTypeIdx] : '').toLowerCase();
    if (entityType && !entityType.includes('affiliation') && !entityType.includes('telegram')) {
      return null;
    }

    const rawName = personNameIdx >= 0 ? entityRow[personNameIdx] : '';
    const rawAlias = aliasIdx >= 0 ? entityRow[aliasIdx] : '';
    const rawProfileUrl = profileUrlIdx >= 0 ? entityRow[profileUrlIdx] : '';
    const rawUid = uidIdx >= 0 ? entityRow[uidIdx] : '';
    const rawEntityId = entityIdIdx >= 0 ? entityRow[entityIdIdx] : '';

    const username = extractTelegramUsername(rawProfileUrl) || extractTelegramUsername(rawAlias);
    if (!username) return null;

    const computedTitle = (rawName || rawAlias || username).trim();
    const title = computedTitle && !isPlaceholderGroupTitle(computedTitle)
      ? computedTitle
      : username;
    const link = `https://t.me/${username}`;
    const id = /^\d+$/.test(rawUid) ? Number(rawUid) : (rawUid || rawEntityId || username);

    if (!title.trim()) {
      return null;
    }

    return {
      title,
      username,
      link,
      id,
      date_updated: normalizeDate(undefined, fallbackTimestamp),
    };
  };

  const relationBased: ParsedConnectedUser[] = [];
  for (const rel of relationRows) {
    const linkType = (linkTypeIdx >= 0 ? rel[linkTypeIdx] : '').toLowerCase();
    if (linkType && !linkType.includes('member')) continue;

    const sourceId = sourceIdIdx >= 0 ? (rel[sourceIdIdx] || '').trim() : '';
    const targetId = targetIdIdx >= 0 ? (rel[targetIdIdx] || '').trim() : '';

    const sourceRow = sourceId ? entityById.get(sourceId) : undefined;
    const targetRow = targetId ? entityById.get(targetId) : undefined;

    const sourceEntry = sourceRow ? buildEntryFromEntity(sourceRow) : null;
    const targetEntry = targetRow ? buildEntryFromEntity(targetRow) : null;

    if (sourceEntry) relationBased.push(sourceEntry);
    if (targetEntry) relationBased.push(targetEntry);
  }

  const candidates = relationBased.length > 0
    ? relationBased
    : dataRows
        .map((row) => buildEntryFromEntity(row))
        .filter((entry): entry is ParsedConnectedUser => Boolean(entry));

  const deduped: ParsedConnectedUser[] = [];
  const seen = new Set<string>();

  for (const entry of candidates) {
    const key = entry.username.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }

  return deduped;
};

export const bkpschSearchController = async (req: Request, res: Response) => {
  try {
    const { query } = req.body as { query?: string };
    const userRequest = req as any;
    logger.info(`bkpschSearchController called. userId=${userRequest.user?._id}, query=${query ?? ''}`);

    if (!query || !query.trim()) {
      logger.warn('bkpschSearchController validation failed: missing query');
      return res.status(400).json({ error: 'Search query is required' });
    }

    const result = await bkpschMutex.runExclusive(async () => {
      return await BkpschAutomation.executeChatFlow(query.trim());
    });

    logger.info(`bkpschSearchController success. userId=${userRequest.user?._id}`);
    return res.status(200).json({ result });
  } catch (error) {
    const userRequest = req as any;
    if (error instanceof Error && error.message === 'TGDB_NO_RESULTS') {
      logger.warn(`bkpschSearchController: No results found on TGDB. userId=${userRequest.user?._id}, query=${req.body.query}`);
      return res.status(404).json({
        error: 'TGDB_NO_RESULTS',
        message: 'there are no results for this search'
      });
    }

    const message = error instanceof Error ? error.message : String(error);
    logger.error(`bkpschSearchController error. userId=${userRequest.user?._id}, error=${message}`);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

export const bkpschNearbyController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { query } = req.body as { query?: string };
    const userRequest = req as any;
    const userId = userRequest.user?._id;
    logger.info(`bkpschNearbyController called. userId=${userId}, query=${query ?? ''}`);

    if (!userId) {
      logger.warn('bkpschNearbyController unauthorized: missing userId');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!query || !query.trim()) {
      logger.warn(`bkpschNearbyController validation failed: missing query. userId=${userId}`);
      return res.status(400).json({ error: 'Search query is required' });
    }

    // Check monthly click limit for connected users button
    const monthlyStatus = await userRepository.getMonthlyClickCountStatus(userId.toString());
    if (monthlyStatus.triesLeft <= 0) {
      logger.warn(`bkpschNearbyController button click monthly limit exceeded. userId=${userId}`);
      return res.status(429).json({
        error: 'Monthly click limit reached',
        triesLeft: 0,
        message: 'You have reached your monthly limit of 15 clicks for this button'
      });
    }

    // Check user credits
    const user = await userRepository.getUserById(userId.toString());
    if (!user || user.credits < CONNECTED_USERS_CREDIT_COST) {
      logger.warn(`bkpschNearbyController insufficient credits. userId=${userId}, credits=${user?.credits ?? 0}`);
      // Pass PaymentRequired error to global error handler
      return next(new PaymentRequired(`Insufficient credits. This action requires ${CONNECTED_USERS_CREDIT_COST} credit.`));
    }

    // Execute automation and parse into a structured fallback-like payload for UI rendering.
    const nearbyResult = await bkpschMutex.runExclusive(async () => {
      return await BkpschAutomation.executeNearbyFlow(query.trim());
    });
    const parsedConnectedUsers = parseConnectedUsersFromNearbyResult(nearbyResult);

    const result = {
      ...nearbyResult,
      user: {
        username: query.trim(),
      },
      meta: {
        num_groups: parsedConnectedUsers.length,
      },
      groups: parsedConnectedUsers,
    };

    // Increment monthly button click count and deduct credits after successful execution
    await userRepository.incrementMonthlyClickCount(userId.toString());
    await userRepository.updateUserCredits(userId.toString(), -CONNECTED_USERS_CREDIT_COST);

    const updatedMonthlyStatus = await userRepository.getMonthlyClickCountStatus(userId.toString());
    const updatedUser = await userRepository.getUserById(userId.toString());
    logger.info(`bkpschNearbyController success. userId=${userId}, creditsRemaining=${updatedUser?.credits}, triesLeft=${updatedMonthlyStatus.triesLeft}`);

    return res.status(200).json({
      result,
      creditsRemaining: updatedUser?.credits,
      triesLeft: updatedMonthlyStatus.triesLeft
    });
  } catch (error) {
    const userRequest = req as any;
    if (error instanceof Error && error.message === 'TGDB_NO_RESULTS') {
      logger.warn(`bkpschNearbyController: No results found on TGDB. userId=${userRequest.user?._id}, query=${req.body.query}`);
      return res.status(404).json({
        error: 'TGDB_NO_RESULTS',
        message: 'there are no results for this search'
      });
    }

    if (error instanceof Error && error.message === 'SESSION_EXPIRED') {
      logger.error(`bkpschNearbyController session expired. userId=${userRequest.user?._id}`);
      return res.status(500).json({ error: 'Internal automation session expired' });
    }
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`bkpschNearbyController error. userId=${userRequest.user?._id}, error=${message}`);
    return next(error);
  }
};
