import type { BackendFeature } from '../types.js';
import { createNvrRoutes } from './routes.js';
import { createNvrPairingRoutes } from './pairing.js';
import { createNvrDeviceRoutes } from './device.js';
import { createNvrRetentionRoutes } from './retention.js';
import { sweepNvrRetention } from './retention-job.js';

export const nvrFeature: BackendFeature={
  key:'nvr',
  version:'1.2.0',
  mount(app,runtime){app.route('/api/v1/nvr',createNvrRoutes(runtime));app.route('/api/v1/nvr',createNvrPairingRoutes(runtime));app.route('/api/v1/nvr',createNvrDeviceRoutes(runtime));app.route('/api/v1/nvr',createNvrRetentionRoutes(runtime));},
  registerJobs(registry){registry.register('nvr.retention.sweep',sweepNvrRetention);},
  schedules:[{name:'nvr-retention-sweep',cron:'23 * * * *',kind:'nvr.retention.sweep',queue:'nvr',maxAttempts:3}],
};
