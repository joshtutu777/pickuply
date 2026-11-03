export const feedLoadError = "We couldn't load jobs.";

export type FeedLoadHandlers<T> = {
  /** When false, a busy load ignores the new request instead of running it afterward. */
  queueIfBusy?: boolean;
  work: () => Promise<T>;
  apply: (value: T, token: number) => void;
  fail: (message: string, token: number) => void;
};

/**
 * One in-flight feed load at a time.
 * A refresh that arrives during that load waits and runs once afterward.
 * It does not retire the load that is already running.
 * retire() drops the current response and any queued refresh so an unmount
 * or a driver change cannot paint those jobs.
 */
export function createFeedLoadController() {
  let generation = 0;
  let inFlight = false;
  let pending = false;
  let follow: (() => void) | null = null;

  function finish() {
    inFlight = false;
    if (!pending) return;
    pending = false;
    follow?.();
  }

  return {
    bind(next: () => void) {
      follow = next;
    },
    queue() {
      pending = true;
    },
    consumeQueue() {
      if (!pending) return false;
      pending = false;
      return true;
    },
    retire() {
      generation += 1;
      pending = false;
    },
    isCurrent(token: number) {
      return token === generation;
    },
    async run<T>({ queueIfBusy = true, work, apply, fail }: FeedLoadHandlers<T>) {
      if (inFlight) {
        if (queueIfBusy) pending = true;
        return;
      }
      const token = ++generation;
      inFlight = true;
      pending = false;
      try {
        const value = await work();
        if (token !== generation) return;
        apply(value, token);
      } catch (error) {
        if (token !== generation) return;
        const message = error instanceof Error && error.message ? error.message : feedLoadError;
        fail(message, token);
      } finally {
        finish();
      }
    },
  };
}
