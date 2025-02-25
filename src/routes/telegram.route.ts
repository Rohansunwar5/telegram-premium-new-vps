import { Router } from 'express';
import { asyncHandler } from '../utils/asynchandler';
import { proxyRequest } from '../controllers/telegram.controller';
import isLoggedIn from '../middlewares/isLoggedIn.middleware';
import multer from 'multer';

import { additionalChannel, searchChannels, startFirstServices, startSecondServices,  } from '../controllers/telegram.controller';

const upload = multer();
const telegramRouter = Router();

telegramRouter.post('/search-channels', isLoggedIn, asyncHandler(searchChannels));
telegramRouter.post('/additional-channel', isLoggedIn, asyncHandler(additionalChannel));
telegramRouter.post('/channel-messages', isLoggedIn, asyncHandler(additionalChannel));
telegramRouter.post('/start-services1', isLoggedIn, asyncHandler(startFirstServices));
telegramRouter.post('/start-services2', isLoggedIn, asyncHandler(startSecondServices));
telegramRouter.post('/proxy', isLoggedIn, upload.none(), asyncHandler(proxyRequest));

export default telegramRouter;
