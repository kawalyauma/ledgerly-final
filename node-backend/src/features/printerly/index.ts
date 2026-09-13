import type { BackendFeature } from '../types.js';
import { createPrinterlyRoutes } from './routes.js';

export const printerlyFeature: BackendFeature={
  key:'printerly',
  version:'1.0.0',
  mount(app,runtime){app.route('/api/v1/printerly',createPrinterlyRoutes(runtime));},
};
