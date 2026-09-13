import type { BackendFeature } from '../types.js';
import { createPrinterlyReleaseNodeRoutes } from '../printerly/release-node.js';

export const printerlyReleaseStationFeature: BackendFeature={
  key:'printerly-release-station',
  version:'1.0.0',
  mount(app,runtime){app.route('/api/v1/printerly',createPrinterlyReleaseNodeRoutes(runtime));},
};
