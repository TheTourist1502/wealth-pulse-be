import { Router } from 'express';
import { authenticate } from '@/middleware/auth';
import * as newsController from '@/routes/news/newsController';

const router = Router();

router.get('/', authenticate, newsController.trending);
router.get('/holdings', authenticate, newsController.holdings);

export default router;
