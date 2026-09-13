import type { BackendFeature } from '../types.js';
import { createWorkRoutes } from './routes.js';
import { createWorkChatRoutes } from './chat.js';
import { createWorkChatCreateRoutes } from './chat-create.js';
import { createWorkChatStateRoutes } from './chat-state.js';
import { createWorkNotificationRoutes } from './notifications.js';
import { runWorkReminders } from './reminders.js';

export const tasksWorkFeature: BackendFeature={
  key:'tasks-work',version:'1.2.0',
  mount(app,runtime){app.route('/api/v1/work',createWorkRoutes(runtime));app.route('/api/v1/work',createWorkChatRoutes(runtime));app.route('/api/v1/work',createWorkChatCreateRoutes(runtime));app.route('/api/v1/work',createWorkChatStateRoutes(runtime));app.route('/api/v1/work',createWorkNotificationRoutes(runtime));},
  registerJobs(registry){registry.register('work.reminders',runWorkReminders);},
  schedules:[{name:'work-reminders',cron:'*/5 * * * *',kind:'work.reminders',queue:'work',maxAttempts:4}],
};
