import { Router } from 'express';
import { authenticate } from '@/middleware/auth';
import * as dashboardController from '@/routes/dashboard/dashboardController';

const router = Router();

router.get('/summary', authenticate, dashboardController.summary);
router.get('/holdings', authenticate, dashboardController.holdings);
router.get('/performance', authenticate, dashboardController.performance);

export default router;
