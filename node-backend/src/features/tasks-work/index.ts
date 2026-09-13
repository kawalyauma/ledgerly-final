import type { BackendFeature } from '../types.js';
import { createWorkRoutes } from './routes.js';
export const tasksWorkFeature: BackendFeature={key:'tasks-work',version:'1.0.0',mount(app,runtime){app.route('/api/v1/work',createWorkRoutes(runtime));}};
