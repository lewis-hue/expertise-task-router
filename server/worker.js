import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { openDb } from './db.js';
import { createService } from './service.js';
import { ROUTING_QUEUE } from './schedulers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = openDb(path.join(dataDir, 'terac.sqlite'));
const service = createService(db);
const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const concurrency = Number(process.env.WORKER_CONCURRENCY || 4);
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
connection.on('error', (err) => console.log(`worker redis error: ${err?.message}`));

const worker = new Worker(ROUTING_QUEUE, async (job) => {
  const attemptId = job.data?.attemptId;
  if (!attemptId) return { ignored: true };
  const task = service.resolveAttempt(attemptId);
  return { taskId: task ? task.id : null };
}, { connection, concurrency });

worker.on('completed', (job) => console.log(`routing job ${job.id} completed`));
worker.on('failed', (job, err) => console.log(`routing job ${job?.id} failed: ${err?.message}`));
worker.on('error', (err) => console.log(`worker error: ${err?.message}`));
console.log(`Routing worker started (queue "${ROUTING_QUEUE}", concurrency ${concurrency}).`);

async function shutdown() {
  await worker.close().catch(() => {});
  connection.disconnect();
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
