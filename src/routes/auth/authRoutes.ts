import { Router } from 'express';
import * as authController from '@/routes/auth/authController';

const router = Router();

router.post('/login', authController.login);

export default router;
