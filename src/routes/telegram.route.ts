import { Router } from 'express';
import { asyncHandler } from '../utils/asynchandler';
import { analyzeChannel, checkPhoneNumber, proxyRequest, tgDev } from '../controllers/telegram.controller';
import isLoggedIn from '../middlewares/isLoggedIn.middleware';
import multer from 'multer';

import { additionalChannel, searchChannels } from '../controllers/telegram.controller';

const upload = multer();
const telegramRouter = Router();

telegramRouter.post('/search-channels', isLoggedIn, asyncHandler(searchChannels));
telegramRouter.post('/additional-channel', isLoggedIn, asyncHandler(additionalChannel));
telegramRouter.post('/channel-messages', isLoggedIn, asyncHandler(additionalChannel));
telegramRouter.post('/proxy', isLoggedIn, upload.none(), asyncHandler(proxyRequest));
telegramRouter.post('/proxy/fetch-messages', isLoggedIn, upload.none(), asyncHandler(tgDev));
telegramRouter.post('/check-phone', isLoggedIn, asyncHandler(checkPhoneNumber));
telegramRouter.post('/analyze-channel', isLoggedIn, asyncHandler(analyzeChannel));

export default telegramRouter;
