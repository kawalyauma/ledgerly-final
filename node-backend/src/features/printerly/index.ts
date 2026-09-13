import type { BackendFeature } from '../types.js';
import { createPrinterlyRoutes } from './routes.js';
import { createPrinterlyNodeAuthRoutes } from './node-auth.js';
import { createPrinterlyNodeJobRoutes } from './node-jobs.js';
import { createPrinterlyCostingRoutes } from './costing-routes.js';
import { createPrinterlyQuotaRoutes } from './quotas.js';
import { createPrinterlyPolicyRoutes } from './policies.js';
import { createPrinterlyReleaseUserRoutes } from './release-user.js';
import { createPrinterlyRoutingBatchRoutes } from './routing-batches.js';
import { createPrinterlyStationRoutes } from './station.js';
import { createPrinterlyRetentionRoutes } from './retention-routes.js';
import { sweepPrinterlyRetention } from './retention-jobs.js';

export const printerlyFeature: BackendFeature={
  key:'printerly',
  version:'1.7.0',
  mount(app,runtime){app.route('/api/v1/printerly',createPrinterlyRoutes(runtime));app.route('/api/v1/printerly',createPrinterlyNodeAuthRoutes(runtime));app.route('/api/v1/printerly',createPrinterlyNodeJobRoutes(runtime));app.route('/api/v1/printerly',createPrinterlyCostingRoutes(runtime));app.route('/api/v1/printerly',createPrinterlyQuotaRoutes(runtime));app.route('/api/v1/printerly',createPrinterlyPolicyRoutes(runtime));app.route('/api/v1/printerly',createPrinterlyReleaseUserRoutes(runtime));app.route('/api/v1/printerly',createPrinterlyRoutingBatchRoutes(runtime));app.route('/api/v1/printerly',createPrinterlyStationRoutes(runtime));app.route('/api/v1/printerly',createPrinterlyRetentionRoutes(runtime));},
  registerJobs(registry){registry.register('printerly.retention.sweep',sweepPrinterlyRetention);},
  schedules:[{name:'printerly-retention-sweep',cron:'17 * * * *',kind:'printerly.retention.sweep',queue:'printerly',maxAttempts:3}],
};
