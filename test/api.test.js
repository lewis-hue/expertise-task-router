import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { createService } from '../server/service.js';
import { createApp } from '../server/app.js';
import { createCache } from '../server/cache.js';
import { seedRows } from '../server/seed.js';
import { request } from './harness.js';
import { waitFor } from './helpers.js';

describe('http api', () => {
  it('drives routine assignment end to end', async (t) => {
    const db = openDb(':memory:');
    seedRows(db);
    const service = createService(db, { timing: { minMs: 10, maxMs: 30, demoMs: 10, neverRate: 0 } });
    const cache = createCache(null);
    const app = createApp(service, cache);
    t.after(async () => {
      await service.shutdown();
      await cache.close();
      db.close();
    });
    const post = (p, body) => request(app, 'POST', p, body);
    const get = (p) => request(app, 'GET', p);

    const created = await post('/api/tasks', { title: 'API-1', expertise_required: 'finance', priority: 'high' });
    assert.equal(created.status, 201);
    const sub = await post(`/api/tasks/${created.body.id}/submit`, { scenario: 'fast-match' });
    assert.equal(sub.status, 200);
    assert.equal(sub.body.task.status, 'routing');
    const detail = await waitFor(async () => {
      const d = await get(`/api/tasks/${created.body.id}`);
      return d.body.task.status === 'proposed' ? d.body : null;
    });
    assert.equal(detail.assignments.length, 1);
    const acc = await post(`/api/assignments/${detail.task.current_assignment_id}/accept`);
    assert.equal(acc.status, 200);
    assert.equal(acc.body.status, 'accepted');

    const ov = await get('/api/overview');
    assert.equal(ov.status, 200);
    assert.equal(ov.headers['x-cache'], 'BYPASS');
    assert.equal(ov.body.queue.scheduler, 'memory');
    assert.ok(ov.body.queue.normal_window_ms > 0);

    const missing = await get('/api/nope');
    assert.equal(missing.status, 404);

    const bad = await post('/api/tasks', { title: '', expertise_required: 'finance' });
    assert.equal(bad.status, 400);

    const reset = await post('/api/admin/reset');
    assert.equal(reset.status, 200);
    assert.equal(reset.body.contributors, 6);
    assert.equal(reset.body.tasks, 8);
  });
});
