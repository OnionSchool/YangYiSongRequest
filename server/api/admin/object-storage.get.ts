import { defineEventHandler, setHeader } from 'h3';
import { requireSuper } from '../../utils/admin-auth';
import { objectStorageBudgetStatus } from '../../utils/object-storage-budget';

export default defineEventHandler((event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  requireSuper(event);
  return objectStorageBudgetStatus();
});
