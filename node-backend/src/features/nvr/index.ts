import type { BackendFeature } from '../types.js';
import { createNvrRoutes } from './routes.js';
import { createNvrPairingRoutes } from './pairing.js';
import { createNvrDeviceRoutes } from './device.js';

export const nvrFeature: BackendFeature={
  key:'nvr',
  version:'1.1.0',
  mount(app,runtime){app.route('/api/v1/nvr',createNvrRoutes(runtime));app.route('/api/v1/nvr',createNvrPairingRoutes(runtime));app.route('/api/v1/nvr',createNvrDeviceRoutes(runtime));},
};
