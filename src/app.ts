import express, { NextFunction, Request, Response } from 'express';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
import cors from 'cors';
//@ts-ignore
import xss from 'xss-clean';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import { getLocalIP } from './utils/system.util';
import logger, { getLogDataInJSONFromReqObject } from './utils/logger';
import { asyncHandler } from './utils/asynchandler';
import { notFound } from './controllers/health.controller';
import { globalHandler } from './middlewares/error-handler.middleware';
import rootRouter from './routes/v1.route';
import { globalLimiter } from './middlewares/rate-limit.middleware';
import config from './config';

const app = express();
app.set('trust proxy', true); // trust nginx x-forwarded-for so the rate-limiter keys on the real client IP
app.set('view engine', 'ejs');
app.set('views', 'src/views');

app.use(express.json({ limit: '8mb' }));
const isLocalhost = (origin: string) =>
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);
    // Only allow localhost origins outside production.
    const allowLocalhost = config.NODE_ENV !== 'production' && isLocalhost(origin);
    if (origin === config.ALLOWED_ORIGIN || allowLocalhost) {
      return callback(null, true);
    }
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(xss());
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", config.ALLOWED_ORIGIN],
      imgSrc: ["'self'", 'data:', 'https:'],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(mongoSanitize());

// @ts-ignore
app.use((req, res, next) => {
  try {
    const log = getLogDataInJSONFromReqObject(req);
    logger.info(`reqLog: ${JSON.stringify(log)}`);
    next();
  } catch (err) {
    logger.error('Request Logger Error - ', err);
    next();
  }
});

app.use(globalLimiter);

app.use(rootRouter);

app.use('*', asyncHandler(notFound));

app.use((
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  data: any, req: Request, res: Response, next: NextFunction
) => {
  globalHandler(data, req, res, next);
});

logger.info(`Local IP - ${getLocalIP()}`);

export default app;