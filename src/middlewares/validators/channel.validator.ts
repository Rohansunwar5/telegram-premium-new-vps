import { validateRequest } from '.';
import { isRequired } from '../../utils/validator.utils';
import { body } from 'express-validator';

export const scrapeChannelValidator = [
  isRequired('channelName'),
  body('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer'),
  body('since').optional().isISO8601().withMessage('Since must be a valid ISO8601 date string'),
  body('triggerWords').optional().isArray().withMessage('Trigger words must be an array of strings'),
  ...validateRequest
];

export const summarizeMessagesValidator = [
  isRequired('channelName'),
  body('messages').isArray({ min: 1 }).withMessage('Messages must be a non-empty array'),
  ...validateRequest
];

export const analyzeChannelValidator = [
  isRequired('channelUsername'),
  body('language').optional().isString().withMessage('Language must be a string'),
  ...validateRequest
];

export const channelInfoValidator = [
  isRequired('channelName'),
  ...validateRequest
];
