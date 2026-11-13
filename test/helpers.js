import { openDb } from '../server/db.js';
import { createService } from '../server/service.js';
import { seedRows } from '../server/seed.js';

export function setup(t, overrides = {}) {
  const db = openDb(':memory:');
  seedRows(db);
  const service = createService(db, {
    timing: { minMs: 15, maxMs: 40, demoMs: 15, neverRate: 0.2 },
    ...overrides,
  });
  t.after(async () => {
    await service.shutdown();
    db.close();
  });
  return { db, service };
}

export async function waitFor(fn, { timeoutMs = 3000, stepMs = 10 } = {}) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function taskByTitle(service, title) {
  return service.listTasks().find((t) => t.title === title);
}
