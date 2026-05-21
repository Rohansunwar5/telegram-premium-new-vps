/* eslint-disable @typescript-eslint/no-non-null-assertion */
import dotenv from 'dotenv';
dotenv.config();

const config = {
  MONGO_URI: process.env.MONGO_URI! as string,
  NODE_ENV: process.env.NODE_ENV! as string,
  REDIS_HOST: process.env.REDIS_HOST! as string,
  REDIS_PORT: process.env.REDIS_PORT! as string,
  REDIS_PASSWORD: process.env.REDIS_PASSORD! as string,
  PORT: process.env.PORT! as string,
  JWT_SECRET: process.env.JWT_SECRET! as string,
  ACCESS_TOKEN_EXPIRY: process.env.ACCESS_TOKEN_EXPIRY! as string,
  OPEN_API_URL: process.env.OPEN_API_URL! as string,
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID! as string,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY! as string,
  AWS_REGION: process.env.AWS_REGION! as string,
  S3_BUCKET_NAME: process.env.S3_BUCKET_NAME! as string,
  GMAIL_USER: process.env.GMAIL_USER! as string,
  GMAIL_PASSWORD: process.env.GMAIL_PASSWORD! as string,

  SERVER_NAME: `${process.env.SERVER_NAME}-${process.env.NODE_ENV}`! as string,
  JWT_CACHE_ENCRYPTION_KEY: process.env.JWT_CACHE_ENCRYPTION_KEY! as string,
  TG_DEV_API_KEY: process.env.TG_DEV_API_KEY! as string,
  ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN! as string,
  BKPSCH_TARGET_URL: (process.env.BKPSCH_TARGET_URL || 'https://www.tgdb.org/bot') as string,
  BKPSCH_HEADLESS: (process.env.BKPSCH_HEADLESS ? process.env.BKPSCH_HEADLESS === 'true' : true) as boolean,
  BKPSCH_TIMEOUT_NAVIGATION: Number(process.env.BKPSCH_TIMEOUT_NAVIGATION || '30000') as number,
  BKPSCH_TIMEOUT_SELECTOR: Number(process.env.BKPSCH_TIMEOUT_SELECTOR || '10000') as number,
  BKPSCH_AUTH_FILE_PATH: (process.env.BKPSCH_AUTH_FILE_PATH || 'auth/bkpsch.auth.json') as string,
  BKPSCH_CHROME_DATA_DIR: (process.env.BKPSCH_CHROME_DATA_DIR || 'auth/bkpsch.chrome_data') as string,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY as string,
  OPENAI_DECOY_MODEL: (process.env.OPENAI_DECOY_MODEL || 'gpt-4o-mini') as string,

  // Local Redis — used by Bull queues, cache client, and Socket.IO adapter
  REDIS_LOCAL_HOST: (process.env.REDIS_LOCAL_HOST || '127.0.0.1') as string,
  REDIS_LOCAL_PORT: Number(process.env.REDIS_LOCAL_PORT || '6379') as number,

  ADMIN_JWT_SECRET: process.env.ADMIN_JWT_SECRET! as string,

  DEFAULT_COUNTRY_CODE: 'IN',
};

export default config;
