/**
 * Small bounded-concurrency primitives. Used by background semantic
 * enrichment (issue #35) to run many LLM round-trips in parallel without
 * exceeding a safe in-flight cap.
 */

/**
 * Classic counting semaphore with FIFO fairness. A finishing task hands its
 * slot directly to the next waiter (no decrement-then-reacquire), so the
 * active count never transiently exceeds the limit even if a new caller
 * arrives in the same microtask.
 */
export class Semaphore {
    private active = 0;
    private readonly queue: Array<() => void> = [];

    constructor(private readonly limit: number) {}

    async run<T>(fn: () => Promise<T>): Promise<T> {
        if (this.active >= this.limit) {
            // Wait for a slot. The releaser hands us the slot without
            // decrementing, so we must NOT increment `active` here.
            await new Promise<void>((resolve) => this.queue.push(resolve));
        } else {
            this.active++;
        }
        try {
            return await fn();
        } finally {
            const next = this.queue.shift();
            if (next) {
                next(); // hand our slot to the next waiter (active stays put)
            } else {
                this.active--; // no waiter: free the slot
            }
        }
    }
}

/**
 * Map `items` through `worker` with at most `limit` calls in flight at once.
 * Results preserve input order. A worker rejection rejects the whole call
 * (use a worker that catches per-item if partial results are wanted).
 */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results: R[] = new Array<R>(items.length);
    if (items.length === 0) return results;
    let next = 0;
    const workers = Math.min(Math.max(1, limit), items.length);
    const runners = Array.from({ length: workers }, async () => {
        for (;;) {
            const i = next++;
            if (i >= items.length) return;
            results[i] = await worker(items[i], i);
        }
    });
    await Promise.all(runners);
    return results;
}
