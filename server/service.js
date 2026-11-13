import { randomUUID } from 'node:crypto';
import { insertEvent } from './db.js';
import { seedRows } from './seed.js';
import { createMemoryScheduler } from './schedulers.js';

export class ServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const SUBMITTABLE = ['draft', 'declined', 'failed', 'no_match'];
const TERMINAL = ['accepted', 'cancelled'];
const PRIORITIES = ['low', 'normal', 'high'];
const SCENARIOS = ['auto', 'fast-match', 'no-match', 'never'];

const nowIso = () => new Date().toISOString();
const normalizeExpertise = (area) => String(area ?? '').trim().toLowerCase();
const hasExpertise = (areas, required) => {
  const normalizedRequired = normalizeExpertise(required);
  return areas.some((area) => normalizeExpertise(area) === normalizedRequired);
};
const parseList = (json) => {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

export function createService(db, opts = {}) {
  const timing = { minMs: 5000, maxMs: 20000, neverRate: 0.2, demoMs: 1500, ...(opts.timing || {}) };
  const random = opts.random || Math.random;
  const scheduler = opts.scheduler || createMemoryScheduler();
  if (typeof scheduler.onFire === 'function') scheduler.onFire((attemptId) => resolveAttempt(attemptId));
  const workerConcurrency = Number(opts.workerConcurrency || process.env.WORKER_CONCURRENCY || 4);

  const getTaskRow = (id) => db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  const getAttemptRow = (id) => db.prepare('SELECT * FROM routing_attempts WHERE id = ?').get(id);
  const getAssignmentRow = (id) => db.prepare('SELECT * FROM assignments WHERE id = ?').get(id);
  const getContributorRow = (id) => db.prepare('SELECT * FROM contributors WHERE id = ?').get(id);

  const event = (taskId, type, detail = {}) => insertEvent(db, taskId, type, detail);

  function contributorView(row) {
    return { id: row.id, name: row.name, expertise: parseList(row.expertise), created_at: row.created_at };
  }

  function pendingAttemptFor(taskId) {
    return db.prepare(`SELECT * FROM routing_attempts
      WHERE task_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`).get(taskId) || null;
  }

  function proposedAssignmentFor(taskId) {
    return db.prepare(`SELECT * FROM assignments
      WHERE task_id = ? AND status = 'proposed' LIMIT 1`).get(taskId) || null;
  }

  function taskView(row) {
    const task = { ...row };
    task.current_assignee = null;
    if (row.current_assignment_id) {
      const current = getAssignmentRow(row.current_assignment_id);
      if (current && (current.status === 'proposed' || current.status === 'accepted')) {
        const c = getContributorRow(current.contributor_id);
        if (c) task.current_assignee = { id: c.id, name: c.name };
      }
    }
    const pending = pendingAttemptFor(row.id);
    task.pending_attempt = pending
      ? { id: pending.id, created_at: pending.created_at, scenario: pending.scenario }
      : null;
    return task;
  }

  function requireTask(id) {
    const task = getTaskRow(id);
    if (!task) throw new ServiceError(404, 'task not found');
    return task;
  }

  function eligibleContributors(expertiseRequired) {
    return db.prepare('SELECT * FROM contributors').all()
      .map(contributorView)
      .filter((c) => hasExpertise(c.expertise, expertiseRequired));
  }

  function createTask({ title, description = '', expertise_required, priority = 'normal' }) {
    const cleanTitle = (title || '').trim();
    const cleanExpertise = (expertise_required || '').trim();
    if (!cleanTitle) throw new ServiceError(400, 'title is required');
    if (!cleanExpertise) throw new ServiceError(400, 'expertise_required is required');
    if (!PRIORITIES.includes(priority)) throw new ServiceError(400, 'priority must be low, normal, or high');
    const now = nowIso();
    const id = randomUUID();
    db.prepare(`INSERT INTO tasks
      (id, title, description, expertise_required, priority, status, current_assignment_id, generation, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, cleanTitle, String(description || ''), cleanExpertise, priority, 'draft', null, 0, now, now);
    event(id, 'task_created', { title: cleanTitle, expertise_required: cleanExpertise, priority });
    return taskView(getTaskRow(id));
  }

  function createContributor({ name, expertise }) {
    const cleanName = (name || '').trim();
    const areas = Array.isArray(expertise) ? expertise.map((e) => String(e).trim()).filter(Boolean) : [];
    if (!cleanName) throw new ServiceError(400, 'name is required');
    if (areas.length === 0) throw new ServiceError(400, 'at least one expertise area is required');
    const id = randomUUID();
    db.prepare('INSERT INTO contributors (id, name, expertise, created_at) VALUES (?, ?, ?, ?)')
      .run(id, cleanName, JSON.stringify([...new Set(areas)]), nowIso());
    return contributorView(getContributorRow(id));
  }

  function planDelay(scenario) {
    if (scenario === 'never') return null;
    if (scenario === 'auto' && random() < timing.neverRate) return null;
    if (scenario === 'auto') return timing.minMs + random() * (timing.maxMs - timing.minMs);
    return timing.demoMs;
  }

  async function submitTask(id, scenario = 'auto') {
    if (!SCENARIOS.includes(scenario)) throw new ServiceError(400, 'unknown routing scenario');
    const task = requireTask(id);
    if (TERMINAL.includes(task.status)) throw new ServiceError(409, `task is ${task.status}; routing is closed`);
    if (task.status === 'routing') throw new ServiceError(409, 'routing already in progress for this task');
    if (task.status === 'proposed') {
      throw new ServiceError(409, 'an assignment is already proposed; resolve it or assign manually to override');
    }
    if (!SUBMITTABLE.includes(task.status)) throw new ServiceError(409, `cannot submit a task with status ${task.status}`);
    const generation = task.generation + 1;
    const eligible = eligibleContributors(task.expertise_required);
    const now = nowIso();
    const attempt = {
      id: randomUUID(), task_id: id, generation, scenario,
      status: 'pending', eligible: eligible.map((c) => c.id), created_at: now,
    };
    db.prepare(`INSERT INTO routing_attempts
      (id, task_id, generation, scenario, status, eligible, chosen_contributor_id, created_at, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(attempt.id, id, generation, scenario, 'pending', JSON.stringify(attempt.eligible), null, now, null);
    db.prepare('UPDATE tasks SET status = ?, generation = ?, updated_at = ? WHERE id = ?')
      .run('routing', generation, now, id);
    const delayMs = planDelay(scenario);
    if (delayMs !== null) await scheduler.schedule(attempt.id, delayMs);
    event(id, 'routing_submitted', {
      scenario, generation, scheduled: delayMs !== null,
      eligible: eligible.map((c) => ({ id: c.id, name: c.name })),
    });
    return { task: taskView(getTaskRow(id)), attempt: { ...attempt, status: 'pending' } };
  }

  function resolveAttempt(attemptId) {
    const attempt = getAttemptRow(attemptId);
    if (!attempt || attempt.status !== 'pending') return null;
    const task = getTaskRow(attempt.task_id);
    if (!task || task.generation !== attempt.generation || task.status !== 'routing') {
      db.prepare(`UPDATE routing_attempts SET status = 'superseded', resolved_at = ? WHERE id = ?`)
        .run(nowIso(), attemptId);
      if (task) event(task.id, 'routing_late_return_ignored', { attempt_id: attemptId, generation: attempt.generation });
      return null;
    }
    const eligibleIds = parseList(attempt.eligible);
    const now = nowIso();
    if (attempt.scenario === 'no-match' || eligibleIds.length === 0) {
      db.prepare(`UPDATE routing_attempts SET status = 'no_match', resolved_at = ? WHERE id = ?`).run(now, attemptId);
      db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run('no_match', now, task.id);
      event(task.id, 'routing_no_match', { attempt_id: attemptId, eligible_count: eligibleIds.length });
      return taskView(getTaskRow(task.id));
    }
    const existing = proposedAssignmentFor(task.id);
    if (existing) {
      db.prepare(`UPDATE routing_attempts SET status = 'superseded', resolved_at = ? WHERE id = ?`).run(now, attemptId);
      event(task.id, 'routing_late_return_ignored', { attempt_id: attemptId, reason: 'assignment already proposed' });
      return null;
    }
    const chosenId = eligibleIds[Math.floor(random() * eligibleIds.length)];
    const assignmentId = randomUUID();
    db.prepare(`INSERT INTO assignments (id, task_id, contributor_id, source, status, created_at, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(assignmentId, task.id, chosenId, 'routing', 'proposed', now, null);
    db.prepare(`UPDATE routing_attempts SET status = 'matched', chosen_contributor_id = ?, resolved_at = ? WHERE id = ?`)
      .run(chosenId, now, attemptId);
    db.prepare('UPDATE tasks SET status = ?, current_assignment_id = ?, updated_at = ? WHERE id = ?')
      .run('proposed', assignmentId, now, task.id);
    const chosen = getContributorRow(chosenId);
    event(task.id, 'routing_matched', { attempt_id: attemptId, contributor_id: chosenId, contributor_name: chosen?.name });
    event(task.id, 'assignment_proposed', { assignment_id: assignmentId, source: 'routing', contributor_id: chosenId });
    return taskView(getTaskRow(task.id));
  }

  async function cancelRouting(id) {
    const task = requireTask(id);
    if (task.status !== 'routing') throw new ServiceError(409, 'no routing in progress for this task');
    const pending = pendingAttemptFor(id);
    const now = nowIso();
    if (pending) {
      await scheduler.cancel(pending.id);
      db.prepare(`UPDATE routing_attempts SET status = 'cancelled', resolved_at = ? WHERE id = ?`).run(now, pending.id);
    }
    db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run('draft', now, id);
    event(id, 'routing_cancelled', { attempt_id: pending?.id || null, by: 'operator' });
    return taskView(getTaskRow(id));
  }

  async function assignManual(taskId, contributorId) {
    const task = requireTask(taskId);
    if (TERMINAL.includes(task.status)) throw new ServiceError(409, `task is ${task.status}; assignments are closed`);
    const contributor = getContributorRow(contributorId);
    if (!contributor) throw new ServiceError(404, 'contributor not found');
    const now = nowIso();
    const generation = task.generation + 1;
    const pending = pendingAttemptFor(taskId);
    if (pending) {
      await scheduler.cancel(pending.id);
      db.prepare(`UPDATE routing_attempts SET status = 'superseded', resolved_at = ? WHERE id = ?`).run(now, pending.id);
      event(taskId, 'routing_superseded_by_operator', { attempt_id: pending.id });
    }
    const previous = proposedAssignmentFor(taskId);
    if (previous) {
      db.prepare(`UPDATE assignments SET status = 'superseded', resolved_at = ? WHERE id = ?`).run(now, previous.id);
      event(taskId, 'assignment_superseded', { assignment_id: previous.id, by: 'operator' });
    }
    const mismatch = !hasExpertise(parseList(contributor.expertise), task.expertise_required);
    const assignmentId = randomUUID();
    db.prepare(`INSERT INTO assignments (id, task_id, contributor_id, source, status, created_at, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(assignmentId, taskId, contributorId, 'manual', 'proposed', now, null);
    db.prepare('UPDATE tasks SET status = ?, current_assignment_id = ?, generation = ?, updated_at = ? WHERE id = ?')
      .run('proposed', assignmentId, generation, now, taskId);
    event(taskId, 'assignment_proposed', {
      assignment_id: assignmentId, source: 'manual', contributor_id: contributorId, mismatch,
    });
    return taskView(getTaskRow(taskId));
  }

  function resolveAssignment(id, outcome) {
    const assignment = getAssignmentRow(id);
    if (!assignment) throw new ServiceError(404, 'assignment not found');
    if (assignment.status !== 'proposed') {
      throw new ServiceError(409, `assignment is ${assignment.status}; only proposed assignments can be resolved`);
    }
    const next = { accept: 'accepted', decline: 'declined', fail: 'failed' }[outcome];
    if (!next) throw new ServiceError(400, 'unknown outcome');
    const now = nowIso();
    db.prepare(`UPDATE assignments SET status = ?, resolved_at = ? WHERE id = ?`).run(next, now, id);
    if (next === 'accepted') {
      db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run('accepted', now, assignment.task_id);
      event(assignment.task_id, 'assignment_accepted', { assignment_id: id });
    } else {
      db.prepare('UPDATE tasks SET status = ?, current_assignment_id = NULL, updated_at = ? WHERE id = ?')
        .run(next, now, assignment.task_id);
      event(assignment.task_id, next === 'declined' ? 'assignment_declined' : 'assignment_failed', { assignment_id: id });
    }
    return taskView(getTaskRow(assignment.task_id));
  }

  function acceptAssignment(id) { return resolveAssignment(id, 'accept'); }
  function declineAssignment(id) { return resolveAssignment(id, 'decline'); }
  function failAssignment(id) { return resolveAssignment(id, 'fail'); }

  function listTasks() {
    return db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all().map(taskView);
  }

  function listContributors() {
    return db.prepare('SELECT * FROM contributors ORDER BY name').all().map((row) => {
      const proposed = db.prepare(`SELECT COUNT(*) AS n FROM assignments WHERE contributor_id = ? AND status = 'proposed'`).get(row.id).n;
      const accepted = db.prepare(`SELECT COUNT(*) AS n FROM assignments WHERE contributor_id = ? AND status = 'accepted'`).get(row.id).n;
      return { ...contributorView(row), proposed_count: proposed, accepted_count: accepted };
    });
  }

  function getTaskDetail(id) {
    const task = requireTask(id);
    const assignments = db.prepare('SELECT * FROM assignments WHERE task_id = ? ORDER BY created_at').all(id)
      .map((a) => {
        const c = getContributorRow(a.contributor_id);
        const contributor = c ? contributorView(c) : null;
        return {
          ...a,
          contributor,
          mismatch: contributor ? !hasExpertise(contributor.expertise, task.expertise_required) : false,
        };
      });
    const attempts = db.prepare('SELECT * FROM routing_attempts WHERE task_id = ? ORDER BY created_at').all(id)
      .map((a) => {
        const eligibleIds = parseList(a.eligible);
        const eligible = eligibleIds
          .map((cid) => getContributorRow(cid))
          .filter(Boolean)
          .map((c) => ({ id: c.id, name: c.name }));
        const chosen = a.chosen_contributor_id ? getContributorRow(a.chosen_contributor_id) : null;
        return {
          ...a,
          eligible_ids: eligibleIds,
          eligible,
          chosen_contributor: chosen ? { id: chosen.id, name: chosen.name } : null,
        };
      });
    const events = db.prepare('SELECT * FROM events WHERE task_id = ? ORDER BY id').all(id).map((e) => {
      let detail = {};
      try { detail = JSON.parse(e.detail); } catch { detail = {}; }
      return { ...e, detail };
    });
    return { task: taskView(task), assignments, attempts, events };
  }

  function getOverview() {
    const taskCounts = {};
    for (const row of db.prepare('SELECT status, COUNT(*) AS n FROM tasks GROUP BY status').all()) {
      taskCounts[row.status] = row.n;
    }
    const pending = db.prepare(`SELECT created_at FROM routing_attempts WHERE status = 'pending'`).all();
    const now = Date.now();
    const pastWindow = pending.filter((p) => now - Date.parse(p.created_at) > timing.maxMs).length;
    const contributors = db.prepare('SELECT COUNT(*) AS n FROM contributors').get().n;
    const activeAssignments = db.prepare(`SELECT COUNT(*) AS n FROM assignments WHERE status = 'proposed'`).get().n;
    const recentEvents = db.prepare(`SELECT e.*, t.title AS task_title FROM events e
      JOIN tasks t ON t.id = e.task_id ORDER BY e.id DESC LIMIT 15`).all().map((e) => {
      let detail = {};
      try { detail = JSON.parse(e.detail); } catch { detail = {}; }
      return { id: e.id, task_id: e.task_id, task_title: e.task_title, type: e.type, detail, created_at: e.created_at };
    });
    return {
      task_counts: taskCounts,
      routing_pending: pending.length,
      past_normal_window: pastWindow,
      contributors,
      active_assignments: activeAssignments,
      recent_events: recentEvents,
    };
  }

  async function getQueueStats() {
    const counts = await scheduler.getCounts();
    return { ...counts, worker_concurrency: workerConcurrency, normal_window_ms: timing.maxMs };
  }

  async function sweepInterrupted() {
    const pending = db.prepare(`SELECT * FROM routing_attempts WHERE status = 'pending'`).all();
    const now = nowIso();
    let tasksReopened = 0;
    for (const attempt of pending) {
      await scheduler.cancel(attempt.id);
      db.prepare(`UPDATE routing_attempts SET status = 'interrupted', resolved_at = ? WHERE id = ?`).run(now, attempt.id);
      const task = getTaskRow(attempt.task_id);
      if (task && task.status === 'routing') {
        db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run('draft', now, task.id);
        event(task.id, 'routing_interrupted', { attempt_id: attempt.id, reason: 'restart' });
        tasksReopened += 1;
      }
    }
    return { interruptedAttempts: pending.length, tasksReopened };
  }

  async function resetDemo() {
    await scheduler.reset();
    db.prepare('DELETE FROM events').run();
    db.prepare('DELETE FROM assignments').run();
    db.prepare('DELETE FROM routing_attempts').run();
    db.prepare('DELETE FROM tasks').run();
    db.prepare('DELETE FROM contributors').run();
    return seedRows(db);
  }

  async function shutdown() {
    await scheduler.close();
  }

  return {
    timing,
    createTask,
    createContributor,
    listTasks,
    listContributors,
    getTaskDetail,
    getOverview,
    getQueueStats,
    submitTask,
    cancelRouting,
    assignManual,
    acceptAssignment,
    declineAssignment,
    failAssignment,
    resolveAttempt,
    sweepInterrupted,
    resetDemo,
    shutdown,
  };
}
