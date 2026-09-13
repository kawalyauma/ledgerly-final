import type { BackendFeature } from '../types.js';
import { createPrinterlyRoutes } from './routes.js';
import { createPrinterlyNodeAuthRoutes } from './node-auth.js';

export const printerlyFeature: BackendFeature={
  key:'printerly',
  version:'1.1.0',
  mount(app,runtime){app.route('/api/v1/printerly',createPrinterlyRoutes(runtime));app.route('/api/v1/printerly',createPrinterlyNodeAuthRoutes(runtime));},
};
