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
import { createScannerlyRoutes } from './scannerly-routes.js';
import { createScannerlyNodeRoutes } from './scannerly-node.js';
import { createScannerlyRoutingRoutes } from './scannerly-routing.js';
import { createPrinterlyConsumableRoutes } from './consumables.js';
import { sweepPrinterlyConsumables } from './consumables-jobs.js';
import { createPrinterlyProcurementRoutes } from './procurement.js';
import { sweepPrinterlyProcurement } from './procurement-jobs.js';
import { createPrinterlyServiceDeskRoutes } from './service-desk.js';
import { runPrinterlyServiceDeskSweep } from './service-desk-jobs.js';
import { createPrinterlyAuditMobileRoutes } from './audit-mobile.js';

export const printerlyFeature: BackendFeature={
  key:'printerly',version:'1.13.0',
  mount(app,runtime){
    app.route('/api/v1/printerly',createPrinterlyRoutes(runtime));app.route('/api/v1/printerly',createPrinterlyNodeAuthRoutes(runtime));app.route('/api/v1/printerly',createPrinterlyNodeJobRoutes(runtime));app.route('/api/v1/printerly',createPrinterlyCostingRoutes(runtime));app.route('/api/v1/printerly',createPrinterlyQuotaRoutes(runtime));app.route('/api/v1/printerly',createPrinterlyPolicyRoutes(runtime));app.route('/api/v1/printerly',createPrinterlyReleaseUserRoutes(runtime));app.route('/api/v1/printerly',createPrinterlyRoutingBatchRoutes(runtime));app.route('/api/v1/printerly',createPrinterlyStationRoutes(runtime));app.route('/api/v1/printerly',createPrinterlyRetentionRoutes(runtime));app.route('/api/v1/printerly',createScannerlyRoutes(runtime));app.route('/api/v1/printerly',createScannerlyNodeRoutes(runtime));app.route('/api/v1/printerly',createScannerlyRoutingRoutes(runtime));app.route('/api/v1/printerly',createPrinterlyConsumableRoutes(runtime));app.route('/api/v1/printerly',createPrinterlyProcurementRoutes(runtime));app.route('/api/v1/printerly',createPrinterlyServiceDeskRoutes(runtime));app.route('/api/v1/printerly',createPrinterlyAuditMobileRoutes(runtime));
  },
  registerJobs(registry){registry.register('printerly.retention.sweep',sweepPrinterlyRetention);registry.register('printerly.consumables.sweep',sweepPrinterlyConsumables);registry.register('printerly.procurement.sweep',sweepPrinterlyProcurement);registry.register('printerly.service-desk.sweep',runPrinterlyServiceDeskSweep);},
  schedules:[{name:'printerly-retention-sweep',cron:'17 * * * *',kind:'printerly.retention.sweep',queue:'printerly',maxAttempts:3},{name:'printerly-consumables-sweep',cron:'*/5 * * * *',kind:'printerly.consumables.sweep',queue:'printerly',maxAttempts:3},{name:'printerly-procurement-sweep',cron:'0 * * * *',kind:'printerly.procurement.sweep',queue:'printerly',maxAttempts:3},{name:'printerly-service-desk-sweep',cron:'*/5 * * * *',kind:'printerly.service-desk.sweep',queue:'printerly',maxAttempts:3}],
};
