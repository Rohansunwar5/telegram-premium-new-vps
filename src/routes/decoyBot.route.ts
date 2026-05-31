import { Router } from 'express';
import isLoggedIn from '../middlewares/isLoggedIn.middleware';
import { asyncHandler } from '../utils/asynchandler';
import {
  createSession,
  listSessions,
  listAccounts,
  getMessages,
  pauseSession,
  resumeSession,
  manualSend,
  deleteSession,
  resetUnseen,
  setObjective,
  clearObjective,
  sendNudge,
} from '../controllers/decoyBot.controller';
import {
  createSessionValidator,
  sessionIdParamValidator,
  setObjectiveValidator,
  setNudgeValidator,
} from '../middlewares/validators/decoyBot.validator';

const decoyBotRouter = Router();

decoyBotRouter.post('/', isLoggedIn, createSessionValidator, asyncHandler(createSession));
decoyBotRouter.get('/', isLoggedIn, asyncHandler(listSessions));
decoyBotRouter.get('/accounts', isLoggedIn, asyncHandler(listAccounts));
decoyBotRouter.get('/:id/messages', isLoggedIn, sessionIdParamValidator, asyncHandler(getMessages));
decoyBotRouter.post('/:id/stop', isLoggedIn, sessionIdParamValidator, asyncHandler(pauseSession));
decoyBotRouter.post('/:id/resume', isLoggedIn, sessionIdParamValidator, asyncHandler(resumeSession));
decoyBotRouter.post('/:id/send', isLoggedIn, sessionIdParamValidator, asyncHandler(manualSend));
decoyBotRouter.post('/:id/unseemsg', isLoggedIn, sessionIdParamValidator, asyncHandler(resetUnseen));
decoyBotRouter.put('/:id/objective', isLoggedIn, setObjectiveValidator, asyncHandler(setObjective));
decoyBotRouter.delete('/:id/objective', isLoggedIn, sessionIdParamValidator, asyncHandler(clearObjective));
decoyBotRouter.post('/:id/nudge', isLoggedIn, setNudgeValidator, asyncHandler(sendNudge));
decoyBotRouter.delete('/:id', isLoggedIn, sessionIdParamValidator, asyncHandler(deleteSession));

export default decoyBotRouter;
