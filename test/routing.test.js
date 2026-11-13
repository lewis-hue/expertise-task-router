import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setup, waitFor, sleep } from './helpers.js';

describe('routing engine', () => {
  it('matches an eligible contributor on the fast path', async (t) => {
    const { service } = setup(t);
    const task = service.createTask({ title: 'T1', expertise_required: 'finance' });
    const { attempt } = await service.submitTask(task.id, 'fast-match');
    assert.equal(attempt.status, 'pending');
    const done = await waitFor(() => {
      const d = service.getTaskDetail(task.id);
      return d.task.status === 'proposed' ? d : null;
    });
    assert.equal(done.assignments.length, 1);
    assert.equal(done.assignments[0].source, 'routing');
    assert.ok(done.assignments[0].contributor.expertise.includes('finance'));
    assert.equal(done.attempts.find((a) => a.id === attempt.id).status, 'matched');
  });

  it('matches contributor expertise regardless of capitalization', async (t) => {
    const { service } = setup(t);
    const task = service.createTask({ title: 'T1b', expertise_required: 'coding' });
    const contributor = service.createContributor({ name: 'Lewis Muguna', expertise: ['Coding'] });
    await service.submitTask(task.id, 'fast-match');
    const done = await waitFor(() => {
      const d = service.getTaskDetail(task.id);
      return d.task.status === 'proposed' ? d : null;
    });
    assert.equal(done.assignments[0].contributor.id, contributor.id);
    assert.deepEqual(done.attempts[0].eligible.map((c) => c.id), [contributor.id]);
    assert.equal(done.assignments[0].mismatch, false);
  });

  it('reports no match when nobody is eligible', async (t) => {
    const { service } = setup(t);
    const task = service.createTask({ title: 'T2', expertise_required: 'quantum law' });
    await service.submitTask(task.id, 'fast-match');
    const done = await waitFor(() => {
      const d = service.getTaskDetail(task.id);
      return d.task.status === 'no_match' ? d : null;
    });
    assert.equal(done.assignments.length, 0);
    assert.equal(done.attempts[0].status, 'no_match');
  });

  it('forced no-match wins even with eligible contributors', async (t) => {
    const { service } = setup(t);
    const task = service.createTask({ title: 'T3', expertise_required: 'finance' });
    await service.submitTask(task.id, 'no-match');
    const done = await waitFor(() => {
      const d = service.getTaskDetail(task.id);
      return d.task.status === 'no_match' ? d : null;
    });
    assert.equal(done.attempts[0].status, 'no_match');
  });

  it('never scenario stays pending with no error, then cancels cleanly', async (t) => {
    const { service } = setup(t);
    const task = service.createTask({ title: 'T4', expertise_required: 'finance' });
    await service.submitTask(task.id, 'never');
    await sleep(120);
    const stuck = service.getTaskDetail(task.id);
    assert.equal(stuck.task.status, 'routing');
    assert.equal(stuck.attempts[0].status, 'pending');
    const cancelled = await service.cancelRouting(task.id);
    assert.equal(cancelled.status, 'draft');
    assert.equal(service.getTaskDetail(task.id).attempts[0].status, 'cancelled');
  });

  it('auto scenario honors the stuck draw', async (t) => {
    const { service } = setup(t, { random: () => 0 });
    const task = service.createTask({ title: 'T5', expertise_required: 'finance' });
    await service.submitTask(task.id, 'auto');
    await sleep(120);
    assert.equal(service.getTaskDetail(task.id).task.status, 'routing');
  });

  it('auto scenario resolves on a lucky draw', async (t) => {
    const { service } = setup(t, { random: () => 0.999 });
    const task = service.createTask({ title: 'T6', expertise_required: 'finance' });
    await service.submitTask(task.id, 'auto');
    const done = await waitFor(() => {
      const d = service.getTaskDetail(task.id);
      return d.task.status === 'proposed' ? d : null;
    });
    assert.equal(done.attempts[0].status, 'matched');
  });

  it('operator action supersedes the pending attempt; no second assignment appears', async (t) => {
    const { service } = setup(t, { timing: { minMs: 15, maxMs: 40, demoMs: 150, neverRate: 0.2 } });
    const task = service.createTask({ title: 'T7', expertise_required: 'finance' });
    const { attempt } = await service.submitTask(task.id, 'fast-match');
    const [contrib] = service.listContributors();
    const manual = await service.assignManual(task.id, contrib.id);
    assert.equal(manual.status, 'proposed');
    await sleep(300);
    const d = service.getTaskDetail(task.id);
    assert.equal(d.task.status, 'proposed');
    assert.equal(d.task.current_assignment_id, manual.current_assignment_id);
    assert.equal(d.assignments.length, 1);
    assert.equal(d.assignments[0].source, 'manual');
    assert.equal(d.attempts.find((a) => a.id === attempt.id).status, 'superseded');
    assert.ok(d.events.some((e) => e.type === 'routing_superseded_by_operator'));
  });

  it('stale generation turns a late return into history, not an assignment', async (t) => {
    const { db, service } = setup(t, { timing: { minMs: 15, maxMs: 40, demoMs: 120, neverRate: 0.2 } });
    const task = service.createTask({ title: 'T8', expertise_required: 'finance' });
    const { attempt } = await service.submitTask(task.id, 'fast-match');
    db.prepare('UPDATE tasks SET generation = generation + 100, status = ? WHERE id = ?').run('proposed', task.id);
    await sleep(300);
    const d = service.getTaskDetail(task.id);
    assert.equal(d.assignments.length, 0);
    assert.equal(d.attempts.find((a) => a.id === attempt.id).status, 'superseded');
    assert.ok(d.events.some((e) => e.type === 'routing_late_return_ignored'));
  });

  it('rejects double submit and submit while proposed', async (t) => {
    const { service } = setup(t);
    const task = service.createTask({ title: 'T9', expertise_required: 'finance' });
    await service.submitTask(task.id, 'never');
    await assert.rejects(() => service.submitTask(task.id, 'fast-match'), /already in progress/);
    const [contrib] = service.listContributors();
    await service.assignManual(task.id, contrib.id);
    await assert.rejects(() => service.submitTask(task.id, 'fast-match'), /already proposed/);
  });
});
