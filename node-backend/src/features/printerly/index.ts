import type { BackendFeature } from '../types.js';
import { createPrinterlyRoutes } from './routes.js';
import { createPrinterlyNodeAuthRoutes } from './node-auth.js';
import { createPrinterlyNodeJobRoutes } from './node-jobs.js';
import { createPrinterlyCostingRoutes } from './costing-routes.js';

export const printerlyFeature: BackendFeature={
  key:'printerly',
  version:'1.3.0',
  mount(app,runtime){app.route('/api/v1/printerly',createPrinterlyRoutes(runtime));app.route('/api/v1/printerly',createPrinterlyNodeAuthRoutes(runtime));app.route('/api/v1/printerly',createPrinterlyNodeJobRoutes(runtime));app.route('/api/v1/printerly',createPrinterlyCostingRoutes(runtime));},
};
