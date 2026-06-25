import { Router } from 'express';
import { asyncHandler } from '../utils/asynchandler';
import {
  genericLogin, profile, signup,
} from '../controllers/auth.controller';
import { loginValidator,signupValidator} from '../middlewares/validators/auth.validator';
import isLoggedIn from '../middlewares/isLoggedIn.middleware';
import { authLimiter } from '../middlewares/rate-limit.middleware';


const authRouter = Router();

authRouter.post('/login', authLimiter, loginValidator, asyncHandler(genericLogin));
authRouter.post('/signup', authLimiter, signupValidator, asyncHandler(signup));
authRouter.get('/profile', isLoggedIn, asyncHandler(profile));
// authRouter.post('/delete-account', isLoggedIn, deleteAccountValidator, asyncHandler(deleteAccount));

export default authRouter;