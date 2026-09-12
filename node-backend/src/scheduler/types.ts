export type ScheduledJobDefinition = {
  name: string;
  cron: string;
  kind: string;
  queue?: string;
  maxAttempts?: number;
  payload?: () => unknown;
};
