import { Router } from 'express';
import { authenticate } from '@/middleware/auth';
import * as portfoliosController from '@/routes/portfolios/portfoliosController';

const router = Router();

router.get('/', authenticate, portfoliosController.list);
router.post('/', authenticate, portfoliosController.create);
router.get('/:id', authenticate, portfoliosController.get);
router.put('/:id', authenticate, portfoliosController.update);
router.delete('/:id', authenticate, portfoliosController.remove);
router.get('/:id/transactions', authenticate, portfoliosController.listTransactions);
router.post('/:id/transactions', authenticate, portfoliosController.createTransaction);
router.delete('/:id/transactions/:transactionId', authenticate, portfoliosController.deleteTransaction);

export default router;
