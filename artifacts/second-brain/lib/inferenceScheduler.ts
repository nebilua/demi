// All native context operations, including tokenization and release, share this
// queue. Priority changes ordering only between operations, never mid-JSI call.
type Job = { priority: number; run: () => Promise<void> };
const queue: Job[] = [];
let running = false;
const retired = new WeakSet<object>();

function drain() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = true;
  void job.run().finally(() => {
    running = false;
    drain();
  });
}

export function scheduleNative<T>(operation: () => Promise<T>, priority = 1): Promise<T> {
  return new Promise((resolve, reject) => {
    queue.push({
      priority,
      run: async () => {
        try { resolve(await operation()); } catch (error) { reject(error); }
      },
    });
    queue.sort((a, b) => a.priority - b.priority);
    drain();
  });
}

export function assertContextUsable(context: object) {
  if (retired.has(context)) throw new Error("The model was unloaded. Reload it in Settings and retry.");
}

export function retireNativeContext(context: object) {
  retired.add(context);
}

export function releaseNativeContext(context: { release: () => Promise<void> }) {
  // Invalidate queued users immediately, but let an active operation finish
  // before release touches its context.
  retireNativeContext(context);
  return scheduleNative(() => context.release(), -1);
}
