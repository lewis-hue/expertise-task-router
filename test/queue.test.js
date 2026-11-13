import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { openDb } from '../server/db.js';
import { createService } from '../server/service.js';
import { createBullScheduler } from '../server/schedulers.js';
import { seedRows } from '../server/seed.js';
import { waitFor, sleep } from './helpers.js';

const redisUrl = process.env.REDIS_URL;

describe('bullmq routing queue (live redis)', { skip: !redisUrl }, () => {
  async function liveSetup(t, timing) {
    const db = openDb(':memory:');
    seedRows(db);
    const queueName = `test-routing-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const scheduler = createBullScheduler(redisUrl, queueName);
    const service = createService(db, { scheduler, timing });
    const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    connection.on('error', () => {});
    const worker = new Worker(queueName, async (job) => {
      service.resolveAttempt(job.data.attemptId);
      return { ok: true };
    }, { connection, concurrency: 2 });
    await worker.waitUntilReady();
    t.after(async () => {
      await worker.close().catch(() => {});
      connection.disconnect();
      await scheduler.reset().catch(() => {});
      await service.shutdown();
      db.close();
    });
    return { service };
  }

  it('processes delayed routing jobs through a real worker', async (t) => {
    const { service } = await liveSetup(t, { minMs: 10, maxMs: 30, demoMs: 60, neverRate: 0 });
    const task = service.createTask({ title: 'Q1', expertise_required: 'finance' });
    await service.submitTask(task.id, 'fast-match');
    const stats = await service.getQueueStats();
    assert.equal(stats.scheduler, 'bullmq');
    const done = await waitFor(() => {
      const d = service.getTaskDetail(task.id);
      return d.task.status === 'proposed' ? d : null;
    });
    assert.equal(done.assignments[0].source, 'routing');
    assert.ok(done.assignments[0].contributor.expertise.includes('finance'));
  });

  it('cancel removes the delayed job from redis', async (t) => {
    const { service } = await liveSetup(t, { minMs: 10, maxMs: 30, demoMs: 10000, neverRate: 0 });
    const task = service.createTask({ title: 'Q2', expertise_required: 'finance' });
    await service.submitTask(task.id, 'fast-match');
    const before = await service.getQueueStats();
    assert.equal(before.delayed, 1);
    await service.cancelRouting(task.id);
    await sleep(100);
    const after = await service.getQueueStats();
    assert.equal(after.delayed + after.waiting + after.active, 0);
    assert.equal(service.getTaskDetail(task.id).task.status, 'draft');
  });
});
