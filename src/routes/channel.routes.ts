import { Router } from 'express';
import { asyncHandler } from '../utils/asynchandler';
import isLoggedIn from '../middlewares/isLoggedIn.middleware';

import {
    scrapeChannel,
    summarizeMessages,
    analyzeChannel,
    getChannelInfo,
    searchChannels,
    getAccountsStatus,
    resetAccountLimits,
    getSupportedLanguages
} from '../controllers/channel.controller';

import {
    scrapeChannelValidator,
    summarizeMessagesValidator,
    analyzeChannelValidator,
    channelInfoValidator
} from '../middlewares/validators/channel.validator';

const router = Router();

// Secure all routes
router.use(isLoggedIn);

router.post('/scrape', scrapeChannelValidator, asyncHandler(scrapeChannel));

router.post('/summarize-messages', summarizeMessagesValidator, asyncHandler(summarizeMessages));

router.post('/analyze-channel', analyzeChannelValidator, asyncHandler(analyzeChannel));

router.post('/channel-info', channelInfoValidator, asyncHandler(getChannelInfo));

router.post('/search', asyncHandler(searchChannels));

router.get('/accounts/status', asyncHandler(getAccountsStatus));

router.post('/accounts/reset-limits', asyncHandler(resetAccountLimits));

router.get('/supported-languages', asyncHandler(getSupportedLanguages));

export default router;
