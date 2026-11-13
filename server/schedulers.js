import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const ROUTING_QUEUE = 'routing';

export function createMemoryScheduler() {
  const timers = new Map();
  let handler = null;

  function cancel(id) {
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
  }

  return {
    type: 'memory',
    onFire(fn) {
      handler = fn;
    },
    async schedule(id, delayMs) {
      cancel(id);
      const timer = setTimeout(() => {
        timers.delete(id);
        if (handler) handler(id);
      }, delayMs);
      if (typeof timer.unref === 'function') timer.unref();
      timers.set(id, timer);
    },
    async cancel(id) {
      cancel(id);
    },
    async reset() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
    async getCounts() {
      return { scheduler: 'memory', waiting: 0, active: 0, delayed: timers.size, workers: [] };
    },
    async close() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}

export function createBullScheduler(redisUrl, queueName = ROUTING_QUEUE) {
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  connection.on('error', (err) => console.log(`queue redis error: ${err?.message}`));
  const queue = new Queue(queueName, { connection });

  return {
    type: 'bullmq',
    async schedule(id, delayMs) {
      await queue.add('route', { attemptId: id }, {
        jobId: id,
        delay: delayMs,
        removeOnComplete: true,
        removeOnFail: true,
      });
    },
    async cancel(id) {
      try {
        const job = await queue.getJob(id);
        if (job) await job.remove();
      } catch {
        // Best effort: a job already picked up by a worker resolves through
        // resolveAttempt, where the DB generation guard ignores stale work.
      }
    },
    async reset() {
      await queue.drain();
    },
    async getCounts() {
      try {
        const counts = await queue.getJobCounts('waiting', 'active', 'delayed');
        const workers = await queue.getWorkers();
        return {
          scheduler: 'bullmq',
          waiting: counts.waiting || 0,
          active: counts.active || 0,
          delayed: counts.delayed || 0,
          workers: (workers || [])
            .map((worker) => worker.rawname || worker.addr)
            .filter(Boolean),
        };
      } catch {
        return { scheduler: 'bullmq', waiting: 0, active: 0, delayed: 0, workers: [], degraded: true };
      }
    },
    async close() {
      await queue.close().catch(() => {});
      connection.disconnect();
    },
  };
}
