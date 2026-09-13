import type { BackendFeature } from '../types.js';
import { createNvrRoutes } from './routes.js';
import { createNvrPairingRoutes } from './pairing.js';
import { createNvrDeviceRoutes } from './device.js';
import { createNvrDeviceEventRoutes } from './device-events.js';
import { createNvrRecordingDeviceRoutes } from './recording-device.js';
import { createNvrRetentionRoutes } from './retention.js';
import { createNvrPlaybackRoutes } from './playback.js';
import { createNvrTimelineRoutes } from './timeline.js';
import { createNvrStorageRoutes } from './storage-pressure.js';
import { createNvrViewerSignalRoutes } from './signaling-viewer.js';
import { createNvrDeviceSignalRoutes } from './signaling-device.js';
import { createNvrRuleRoutes } from './rules.js';
import { sweepNvrRetention } from './retention-job.js';
import { sweepNvrOffline } from './offline-job.js';
import { sweepNvrEventRules } from './rules-job.js';
import { sweepNvrStoragePressure } from './storage-pressure-job.js';

export const nvrFeature: BackendFeature={
  key:'nvr',
  version:'1.8.0',
  mount(app,runtime){app.route('/api/v1/nvr',createNvrRoutes(runtime));app.route('/api/v1/nvr',createNvrPairingRoutes(runtime));app.route('/api/v1/nvr',createNvrDeviceRoutes(runtime));app.route('/api/v1/nvr',createNvrDeviceEventRoutes(runtime));app.route('/api/v1/nvr',createNvrRecordingDeviceRoutes(runtime));app.route('/api/v1/nvr',createNvrRetentionRoutes(runtime));app.route('/api/v1/nvr',createNvrPlaybackRoutes(runtime));app.route('/api/v1/nvr',createNvrTimelineRoutes(runtime));app.route('/api/v1/nvr',createNvrStorageRoutes(runtime));app.route('/api/v1/nvr',createNvrViewerSignalRoutes(runtime));app.route('/api/v1/nvr',createNvrDeviceSignalRoutes(runtime));app.route('/api/v1/nvr',createNvrRuleRoutes(runtime));},
  registerJobs(registry){registry.register('nvr.retention.sweep',sweepNvrRetention);registry.register('nvr.offline.sweep',sweepNvrOffline);registry.register('nvr.event-rules.sweep',sweepNvrEventRules);registry.register('nvr.storage-pressure.sweep',sweepNvrStoragePressure);},
  schedules:[{name:'nvr-retention-sweep',cron:'23 * * * *',kind:'nvr.retention.sweep',queue:'nvr',maxAttempts:3},{name:'nvr-offline-sweep',cron:'* * * * *',kind:'nvr.offline.sweep',queue:'nvr',maxAttempts:3},{name:'nvr-event-rules-sweep',cron:'* * * * *',kind:'nvr.event-rules.sweep',queue:'nvr',maxAttempts:3},{name:'nvr-storage-pressure-sweep',cron:'*/5 * * * *',kind:'nvr.storage-pressure.sweep',queue:'nvr',maxAttempts:3}],
};
