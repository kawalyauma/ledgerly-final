import type { BackendFeature } from '../types.js';
import { createNvrHealthRoutes } from '../nvr-observability/dashboard.js';
import { createNvrHistoryRoutes } from '../nvr-observability/history.js';

export const nvrMetricsFeature: BackendFeature={
  key:'nvr-metrics',
  version:'1.0.0',
  mount(app,runtime){app.route('/api/v1/nvr',createNvrHealthRoutes(runtime));app.route('/api/v1/nvr',createNvrHistoryRoutes(runtime));},
};
