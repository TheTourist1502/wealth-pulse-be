import { Router } from 'express';
import { authenticate } from '@/middleware/auth';
import * as authController from '@/routes/auth/authController';

const router = Router();

router.post('/login', authController.login);
router.post('/refresh-token', authController.refresh);
router.post('/logout', authController.logout);
router.get('/me', authenticate, authController.me);

export default router;
