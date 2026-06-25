import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import redisClient from '../services/cache';

// Back the limiters with the shared (connected) redis cache client so counters
// are shared across all cluster workers. node-redis v4 sendCommand takes an
// array of string args. Each limiter uses a distinct prefix so their counters
// don't collide on the same client IP.
const store = (prefix: string) =>
  new RedisStore({
    prefix,
    sendCommand: (...args: string[]) => redisClient.sendCommand(args),
  });

// trust proxy is intentionally set (nginx in front); silence the permissive
// trust-proxy validation rather than have it log on every request.
const common = {
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
};

// Generous global backstop.
export const globalLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 300,
  store: store('rl:global:'),
});

// Strict — login / signup. Only failed attempts count, so a logged-in user
// hammering legit requests isn't locked out by their own successful logins.
export const authLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  store: store('rl:auth:'),
});

// Moderate — OpenAI-backed / expensive routes.
export const aiLimiter = rateLimit({
  ...common,
  windowMs: 5 * 60 * 1000,
  limit: 30,
  store: store('rl:ai:'),
});
