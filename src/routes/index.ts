import { Router } from 'express';
import authRoutes from '@/routes/auth/authRoutes';
import dashboardRoutes from '@/routes/dashboard/dashboardRoutes';
import marketRoutes from '@/routes/market/marketRoutes';
import newsRoutes from '@/routes/news/newsRoutes';
import portfoliosRoutes from '@/routes/portfolios/portfoliosRoutes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/portfolios', portfoliosRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/market', marketRoutes);
router.use('/news', newsRoutes);

export default router;
