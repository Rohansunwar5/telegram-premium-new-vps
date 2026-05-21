import { Router } from 'express';
import { asyncHandler } from '../utils/asynchandler';
import isAdminLoggedIn from '../middlewares/isAdminLoggedIn.middleware';
import { adminLogin, adminSignup } from '../controllers/adminAuth.controller';
import { listAccounts, addAccount, deleteAccount } from '../controllers/decoyAdmin.controller';
import { addAccountValidator, accountIdParamValidator } from '../middlewares/validators/decoyAdmin.validator';
import { loginValidator } from '../middlewares/validators/auth.validator';

const decoyAdminRouter = Router();

// Public — admin login
decoyAdminRouter.post('/auth/login', loginValidator, asyncHandler(adminLogin));

// Public — admin signup (open for testing; restrict before production)
decoyAdminRouter.post('/auth/signup', loginValidator, asyncHandler(adminSignup));

// Protected — account pool management
decoyAdminRouter.get('/decoy-accounts', isAdminLoggedIn, asyncHandler(listAccounts));
decoyAdminRouter.post('/decoy-accounts', isAdminLoggedIn, addAccountValidator, asyncHandler(addAccount));
decoyAdminRouter.delete('/decoy-accounts/:id', isAdminLoggedIn, accountIdParamValidator, asyncHandler(deleteAccount));

export default decoyAdminRouter;
