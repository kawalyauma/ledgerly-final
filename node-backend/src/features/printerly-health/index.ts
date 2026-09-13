import type { BackendFeature } from '../types.js';
import { createPrinterlyHealthRoutes } from './routes.js';
import { sweepPrinterlyHealth } from './jobs.js';

export const printerlyHealthFeature: BackendFeature={
  key:'printerly-health',
  version:'1.0.0',
  mount(app,runtime){app.route('/api/v1/printerly',createPrinterlyHealthRoutes(runtime));},
  registerJobs(registry){registry.register('printerly.health_sweep',sweepPrinterlyHealth);},
  schedules:[{name:'printerly-health-sweep',cron:'* * * * *',kind:'printerly.health_sweep',queue:'printerly',maxAttempts:3}],
};
