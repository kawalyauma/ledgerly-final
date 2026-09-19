export class LedgerlyAiQueueFullError extends Error {
  constructor(readonly maxQueue: number) {
    super(`Ledgerly AI queue is full (limit ${maxQueue}).`);
    this.name = "LedgerlyAiQueueFullError";
  }
}

type QueueItem<T> = {
  id: string;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

export class LedgerlyAiExecutionQueue {
  private activeCount = 0;
  private readonly pending: QueueItem<unknown>[] = [];

  constructor(readonly maxConcurrency: number, readonly maxQueue: number) {}

  get active() { return this.activeCount; }
  get queued() { return this.pending.length; }

  submit<T>(id: string, run: () => Promise<T>): Promise<T> {
    if (this.pending.length >= this.maxQueue) {
      return Promise.reject(new LedgerlyAiQueueFullError(this.maxQueue));
    }
    return new Promise<T>((resolve, reject) => {
      this.pending.push({ id, run, resolve: resolve as (value: unknown) => void, reject });
      this.drain();
    });
  }

  cancelQueued(id: string) {
    const index = this.pending.findIndex((item) => item.id === id);
    if (index < 0) return false;
    const [item] = this.pending.splice(index, 1);
    item?.reject(new Error("Ledgerly AI execution was cancelled before it started."));
    return true;
  }

  private drain() {
    while (this.activeCount < this.maxConcurrency && this.pending.length) {
      const item = this.pending.shift();
      if (!item) return;
      this.activeCount += 1;
      void item.run()
        .then(item.resolve, item.reject)
        .finally(() => {
          this.activeCount -= 1;
          this.drain();
        });
    }
  }
}
