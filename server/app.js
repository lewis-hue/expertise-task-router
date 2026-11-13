import express from 'express';
import { ServiceError } from './service.js';

const OVERVIEW_KEY = 'terac:overview';
const TASKS_KEY = 'terac:tasks';
const CACHE_TTL_SEC = 5;

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res)).catch(next);
};

export function createApp(service, cache) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  const bust = () => cache.del(OVERVIEW_KEY, TASKS_KEY);

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, time: new Date().toISOString(), cache: cache.type });
  });

  app.get('/api/overview', asyncHandler(async (req, res) => {
    const hit = await cache.get(OVERVIEW_KEY);
    if (hit) {
      res.set('X-Cache', 'HIT');
      return res.json(hit);
    }
    const overview = service.getOverview();
    const queue = await service.getQueueStats();
    const body = { ...overview, queue };
    await cache.set(OVERVIEW_KEY, body, CACHE_TTL_SEC);
    res.set('X-Cache', cache.type === 'none' ? 'BYPASS' : 'MISS');
    res.json(body);
  }));

  app.get('/api/tasks', asyncHandler(async (req, res) => {
    const hit = await cache.get(TASKS_KEY);
    if (hit) {
      res.set('X-Cache', 'HIT');
      return res.json(hit);
    }
    const tasks = service.listTasks();
    await cache.set(TASKS_KEY, tasks, CACHE_TTL_SEC);
    res.set('X-Cache', cache.type === 'none' ? 'BYPASS' : 'MISS');
    res.json(tasks);
  }));

  app.post('/api/tasks', asyncHandler(async (req, res) => {
    const task = service.createTask(req.body || {});
    await bust();
    res.status(201).json(task);
  }));

  app.get('/api/tasks/:id', asyncHandler(async (req, res) => {
    res.json(service.getTaskDetail(req.params.id));
  }));

  app.post('/api/tasks/:id/submit', asyncHandler(async (req, res) => {
    const result = await service.submitTask(req.params.id, req.body?.scenario || 'auto');
    await bust();
    res.json(result);
  }));

  app.post('/api/tasks/:id/cancel-routing', asyncHandler(async (req, res) => {
    const task = await service.cancelRouting(req.params.id);
    await bust();
    res.json(task);
  }));

  app.post('/api/tasks/:id/assign', asyncHandler(async (req, res) => {
    const task = await service.assignManual(req.params.id, req.body?.contributor_id);
    await bust();
    res.json(task);
  }));

  app.post('/api/assignments/:id/accept', asyncHandler(async (req, res) => {
    const task = service.acceptAssignment(req.params.id);
    await bust();
    res.json(task);
  }));

  app.post('/api/assignments/:id/decline', asyncHandler(async (req, res) => {
    const task = service.declineAssignment(req.params.id);
    await bust();
    res.json(task);
  }));

  app.post('/api/assignments/:id/fail', asyncHandler(async (req, res) => {
    const task = service.failAssignment(req.params.id);
    await bust();
    res.json(task);
  }));

  app.get('/api/contributors', (req, res) => {
    res.json(service.listContributors());
  });

  app.post('/api/contributors', asyncHandler(async (req, res) => {
    const contributor = service.createContributor(req.body || {});
    await bust();
    res.status(201).json(contributor);
  }));

  app.post('/api/admin/reset', asyncHandler(async (req, res) => {
    const result = await service.resetDemo();
    await bust();
    res.json(result);
  }));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'unknown api route' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ServiceError) return res.status(err.status).json({ error: err.message });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON body' });
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
