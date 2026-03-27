import { Router } from 'express';
import { bkpschSearchController, bkpschNearbyController } from '../controllers/bkpsch.controller';
import isLoggedIn from '../middlewares/isLoggedIn.middleware';

const bkpschRouter = Router();

bkpschRouter.post('/search', bkpschSearchController);
bkpschRouter.post('/searchNearby', isLoggedIn, bkpschNearbyController);

export default bkpschRouter;
