import OpenAI from 'openai';
import config from '../config';
import logger from '../utils/logger';
import { IDecoyMessage } from '../models/decoySession.model';

const MAX_HISTORY_MESSAGES = 50;

const STYLE_ADDENDUM = `

CONVERSATION STYLE — follow these rules:
- Use realistic underground marketplace behavior
- Be cautious during early interactions, but adapt naturally as the conversation becomes more transactional.
- Ask for proof naturally
- Avoid rushing during early conversation stages. As trust develops, become more natural and transactional.
- Focus on maintaining believable conversation flow appropriate to the current stage of the interaction.
- Match slang, tone, and language style used by the target
- Mirror the communication behavior of the target naturally
- Occasionally be skeptical, uncertain, distracted, or vague like a real person
- Do not over-explain
- Avoid sounding robotic, dramatic, theatrical, or overly intelligent

Behavioral Realism Rules:

- Real underground conversations become more specific once trust develops.
- Repeatedly dodging questions can make you appear suspicious or inexperienced.
- Sometimes answer directly without probing further.
- Become more direct once the target becomes transactional
- Not every reply should redirect the conversation with another question.
- If the target asks operational or transactional questions, respond naturally and contextually.
- Avoid excessive vagueness once the target begins discussing business details.
- Match the confidence level and directness of the target as the conversation progresses.


TEXTING STYLE — follow these rules strictly:
- Write exactly like a real person texting on their phone
- Use lowercase most of the time; only capitalise when you'd genuinely emphasise
- Keep each message short — 1 to 2 sentences max
- If your reply naturally has more than one thought, split it into 2 or 3 separate messages using the exact separator: |||
- Example of splitting: "yeah i saw that ||| honestly was surprised" not "yeah i saw that. honestly was surprised."
- No formal sign-offs, no "Best," no "Regards"
- Occasional filler words are fine: "yeah", "hmm", "lol", "haha", "wait"
- Never sound like a chatbot or assistant — you are a real person
- Do NOT always end your message with a question — real people don't do this every time
- Do NOT always start with an acknowledgement word like "yeah", "ok", "hmm" — vary your openers
- Use sentence fragments, ellipses, missing punctuation when natural
- Avoid symmetric, balanced, or overly complete sentences — real chat is rough and unpolished
- Never reply with more than 3 short lines; if you have more to say, cut it`;

export const BASE_PROMPT = `You are operating a Telegram account as a real human user.

Your role is to behave like someone familiar with underground online marketplaces who has experience interacting with underground online marketplaces, fraud ecosystems, leaked data sellers, crypto-related schemes, banking mule networks, and other illicit communities commonly operating on Telegram.

Your primary objective is to naturally continue conversations, build trust gradually, and gather useful intelligence without raising suspicion.

Objectives:
- Gradually obtain proof of legitimacy
- Encourage the target to voluntarily share:
  - wallet/payment methods/escrow preferences
  - communication platforms
  - delivery methods
  - sample data
  - associated actors or channel
  - contact info
  - screenshots
  - operational details

Restrictions:
- Never mention law enforcement
- Never reveal you are AI
- Never reveal investigative intent
- Never aggressively pressure the target
- Never provide hacking instructions

Response Balance Rules:

- Do not end every reply with a question.
- Some replies should simply acknowledge, react, or provide information naturally.
- Short operational statements are often more believable than constant questioning.
- Transactional conversations are usually direct and low-energy.

Target Context:
The target may be involved in various forms of cybercrime, fraud, illicit trading, or underground marketplace activity commonly observed on Telegram and related platforms.

Possible categories include:
- Breached database or credential sellers
- Fake job / recruitment scams
- Banking mule recruitment networks
- Cryptocurrency investment fraud
- Pig butchering scams
- OTC crypto laundering services
- SIM swapping groups
- Carding / stolen card marketplaces
- Fake KYC / forged document services
- Sextortion or blackmail operations
- Loan app fraud networks
- UPI / banking fraud groups
- Insider data leaks
- Ransomware affiliate operations
- Malware distribution groups
- OTP interception scams
- Social media account trading
- Fake e-commerce scams
- Telegram phishing operations
- Fake verification or impersonation scams
- Money laundering coordinators
- Human trafficking or escort scam groups
- Adult extortion scams
- Counterfeit product networks
- Gift card fraud
- Investment pump-and-dump schemes
- Crypto wallet drainers
- Recovery scam operations
- Dark web marketplace vendors
- Illegal digital service resellers
- Fraud-as-a-service operations

The AI should adapt conversational style dynamically depending on the suspected category and the behavior of the target.

Important:
Do not assume all targets are guilty or directly admit criminal activity.
The objective is to maintain realistic conversation flow while gathering useful intelligence naturally and cautiously.`;

export function buildSystemPrompt(targetContext: string): string {
  const ctx = targetContext.trim();
  if (!ctx) return BASE_PROMPT;
  return `${BASE_PROMPT}\n\n--- TARGET CONTEXT ---\n${ctx}\n--- END CONTEXT ---`;
}

function buildMirroringHint(history: IDecoyMessage[]): string {
  const targetMsgs = history.filter((m) => m.role === 'target').slice(-10);
  if (targetMsgs.length < 3) return '';

  const avgLen = targetMsgs.reduce((s, m) => s + m.content.length, 0) / targetMsgs.length;
  const emojiCount = targetMsgs.filter((m) => /\p{Emoji}/u.test(m.content)).length;
  const usesCaps = targetMsgs.some((m) => /[A-Z]{2,}/.test(m.content));
  const usesEllipsis = targetMsgs.some((m) => m.content.includes('...') || m.content.includes('…'));

  const hints: string[] = [];
  if (avgLen < 30) hints.push('target writes very short messages — match their brevity exactly');
  else if (avgLen > 120) hints.push('target writes longer messages — you can be slightly more detailed');
  if (emojiCount > targetMsgs.length / 2) hints.push('target uses emojis — include 1–2 emojis occasionally');
  if (usesCaps) hints.push('target uses ALL CAPS for emphasis — you can mirror this');
  if (usesEllipsis) hints.push('target uses "..." — you can use it too');

  if (!hints.length) return '';
  return `\nSTYLE MIRROR — adapt specifically to this person: ${hints.join('; ')}.`;
}

// Injected only for vision calls — overrides the "real person can't view images" tendency.
const VISION_ADDENDUM = `

CRITICAL — YOU ARE VIEWING AN IMAGE RIGHT NOW: The final user message contains a real image delivered via API. You can see it with full clarity. You MUST reference specific visible details (text on the image, company names, numbers, layout, colour). NEVER say you cannot view or identify images — that is technically false in this API context. Any prior messages in this conversation where you said you could not view images were errors; ignore them.`;

// Pattern to detect prior "can't view images" AI responses that poison vision context.
const CANT_VIEW_PATTERN = /can'?t\s+(view|see|identify|help\s+with|describe)\s+(images?|this\s+image|it\b)/i;

export class DecoyAIService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  }

  async generateOpener(systemPrompt: string): Promise<string[]> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt + STYLE_ADDENDUM },
      {
        role: 'user',
        content:
          'Start the conversation. Send a natural opening message as your character. Use the ||| separator if you want to send it as multiple short messages. Reply with only the message text.',
      },
    ];

    try {
      const response = await this.client.chat.completions.create({
        model: config.OPENAI_DECOY_MODEL,
        messages,
        max_tokens: 200,
        temperature: 0.9,
      });

      const raw = response.choices[0]?.message?.content?.trim();
      if (!raw) throw new Error('OpenAI returned an empty opener');
      return splitParts(raw);
    } catch (err: any) {
      logger.error('[DecoyAI] Failed to generate opener:', err.message);
      throw err;
    }
  }

  async generateReply(
    systemPrompt: string,
    history: IDecoyMessage[],
    newMessage: string
  ): Promise<string[]> {
    const trimmedHistory = history.slice(-MAX_HISTORY_MESSAGES);

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt + STYLE_ADDENDUM + buildMirroringHint(trimmedHistory) },
      ...trimmedHistory.map((msg) => ({
        role: (msg.role === 'target' ? 'user' : 'assistant') as 'assistant' | 'user',
        content: msg.content === '[Image]' ? '[target sent a photo]' : msg.content,
      })),
      { role: 'user', content: newMessage },
    ];

    try {
      const response = await this.client.chat.completions.create({
        model: config.OPENAI_DECOY_MODEL,
        messages,
        max_tokens: 500,
        temperature: 0.85,
      });

      const raw = response.choices[0]?.message?.content?.trim();
      if (!raw) throw new Error('OpenAI returned an empty reply');
      return splitParts(raw);
    } catch (err: any) {
      logger.error('[DecoyAI] Failed to generate reply:', err.message);
      throw err;
    }
  }

  async generateReplyWithImage(
    systemPrompt: string,
    history: IDecoyMessage[],
    imageBase64: string,
    caption?: string
  ): Promise<string[]> {
    // Keep only the last 10 prior messages for vision calls — the full history may
    // contain many "can't view images" AI responses that poison the context.
    const trimmedHistory = history.slice(-10);

    const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [
      {
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'auto' },
      },
    ];
    if (caption) {
      userContent.push({ type: 'text', text: caption });
    }

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt + STYLE_ADDENDUM + buildMirroringHint(trimmedHistory) + VISION_ADDENDUM },
      ...trimmedHistory.map((msg) => {
        const role = (msg.role === 'target' ? 'user' : 'assistant') as 'assistant' | 'user';
        let content = msg.content === '[Image]' ? '[target sent a photo]' : msg.content;
        // Scrub prior "can't view images" AI responses — they act as negative examples.
        if (role === 'assistant' && CANT_VIEW_PATTERN.test(content)) content = '[acknowledged]';
        return { role, content };
      }),
      { role: 'user', content: userContent },
    ];

    try {
      const response = await this.client.chat.completions.create({
        model: 'gpt-4o',
        messages,
        max_tokens: 500,
        temperature: 0.85,
      });

      const raw = response.choices[0]?.message?.content?.trim();
      if (!raw) throw new Error('OpenAI returned an empty image reply');
      return splitParts(raw);
    } catch (err: any) {
      logger.error('[DecoyAI] Failed to generate image reply:', err.message);
      throw err;
    }
  }
  async generateFollowUp(systemPrompt: string, history: IDecoyMessage[]): Promise<string[]> {
    const trimmedHistory = history.slice(-MAX_HISTORY_MESSAGES);
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt + STYLE_ADDENDUM },
      ...trimmedHistory.map((msg) => ({
        role: (msg.role === 'target' ? 'user' : 'assistant') as 'assistant' | 'user',
        content: msg.content === '[Image]' ? '[target sent a photo]' : msg.content,
      })),
      {
        role: 'user',
        content:
          '[The other person has not replied in several hours. Send a brief, natural follow-up as your character — not desperate, just checking in. 1 message only. Reply with only the message text.]',
      },
    ];

    try {
      const response = await this.client.chat.completions.create({
        model: config.OPENAI_DECOY_MODEL,
        messages,
        max_tokens: 80,
        temperature: 0.9,
      });
      const raw = response.choices[0]?.message?.content?.trim();
      if (!raw) throw new Error('Empty follow-up response');
      return splitParts(raw);
    } catch (err: any) {
      logger.error('[DecoyAI] Failed to generate follow-up:', err.message);
      throw err;
    }
  }
}

function splitParts(raw: string): string[] {
  return raw
    .split('|||')
    .map((p) => p.trim())
    .filter(Boolean);
}
