import { Router } from 'express';
import { bkpschSearchController } from '../controllers/bkpsch.controller';

const bkpschRouter = Router();

bkpschRouter.post('/search', bkpschSearchController);

export default bkpschRouter;
