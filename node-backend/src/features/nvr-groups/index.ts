import type { BackendFeature } from '../types.js';
import { createNvrGroupRoutes } from '../nvr/groups.js';

export const nvrGroupsFeature: BackendFeature={
  key:'nvr-groups',
  version:'1.0.0',
  mount(app,runtime){app.route('/api/v1/nvr',createNvrGroupRoutes(runtime));},
};
