/**
 * A simple zero-dependency Mutex to synchronize access to shared resources (like the TGDB browser session).
 * Ensures that only one automation task runs at a time to prevent data bleeding and interleaving.
 */
export class Mutex {
  private mutex = Promise.resolve();

  /**
   * Acquires the lock, runs the provided callback, and releases the lock.
   * @param callback The async function to execute safely.
   * @returns The result of the callback.
   */
  async runExclusive<T>(callback: () => Promise<T>): Promise<T> {
    let release: (value: void | PromiseLike<void>) => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });

    const previous = this.mutex;
    this.mutex = previous.then(() => waiting);

    await previous;

    try {
      return await callback();
    } finally {
      release!();
    }
  }
}
