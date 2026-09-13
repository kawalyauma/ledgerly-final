import type { BackendFeature } from '../types.js';
import { createNvrRoutes } from './routes.js';

export const nvrFeature: BackendFeature={
  key:'nvr',
  version:'1.0.0',
  mount(app,runtime){app.route('/api/v1/nvr',createNvrRoutes(runtime));},
};
