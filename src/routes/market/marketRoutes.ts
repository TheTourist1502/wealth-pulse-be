import { Router } from 'express';
import { authenticate } from '@/middleware/auth';
import * as marketController from '@/routes/market/marketController';

const router = Router();

router.get('/indices', authenticate, marketController.indices);
router.get('/movers', authenticate, marketController.movers);

export default router;
