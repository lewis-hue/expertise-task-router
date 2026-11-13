import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setup, waitFor } from './helpers.js';

describe('assignments and recovery', () => {
  it('manual assignment keeps at most one active assignee', async (t) => {
    const { service } = setup(t);
    const task = service.createTask({ title: 'A1', expertise_required: 'finance' });
    const [first, second] = service.listContributors();
    await service.assignManual(task.id, first.id);
    const reassigned = await service.assignManual(task.id, second.id);
    assert.equal(reassigned.status, 'proposed');
    const d = service.getTaskDetail(task.id);
    assert.equal(d.assignments.filter((a) => a.status === 'proposed').length, 1);
    assert.equal(d.task.current_assignee.id, second.id);
    assert.ok(d.events.some((e) => e.type === 'assignment_superseded'));
  });

  it('accept closes routing; the task becomes terminal', async (t) => {
    const { service } = setup(t);
    const task = service.createTask({ title: 'A2', expertise_required: 'finance' });
    const [contrib] = service.listContributors();
    const assigned = await service.assignManual(task.id, contrib.id);
    const accepted = service.acceptAssignment(assigned.current_assignment_id);
    assert.equal(accepted.status, 'accepted');
    await assert.rejects(() => service.submitTask(task.id, 'fast-match'), /routing is closed/);
    await assert.rejects(() => service.assignManual(task.id, contrib.id), /assignments are closed/);
  });

  it('decline and fail reopen the task for retry or manual recovery', async (t) => {
    const { service } = setup(t);
    const task = service.createTask({ title: 'A3', expertise_required: 'finance' });
    const [contrib] = service.listContributors();
    const first = await service.assignManual(task.id, contrib.id);
    const declined = service.declineAssignment(first.current_assignment_id);
    assert.equal(declined.status, 'declined');
    assert.equal(declined.current_assignee, null);
    const resubmitted = await service.submitTask(task.id, 'fast-match');
    assert.equal(resubmitted.task.status, 'routing');
    const routed = await waitFor(() => {
      const d = service.getTaskDetail(task.id);
      return d.task.status === 'proposed' ? d : null;
    });
    const failed = service.failAssignment(routed.task.current_assignment_id);
    assert.equal(failed.status, 'failed');
    const recovered = await service.assignManual(task.id, contrib.id);
    assert.equal(recovered.status, 'proposed');
  });

  it('records expertise mismatch instead of refusing', async (t) => {
    const { service } = setup(t);
    const task = service.createTask({ title: 'A4', expertise_required: 'finance' });
    const opsOnly = service.listContributors().find((c) => c.expertise.length === 1 && c.expertise[0] === 'operations');
    assert.ok(opsOnly);
    await service.assignManual(task.id, opsOnly.id);
    const d = service.getTaskDetail(task.id);
    assert.equal(d.assignments[0].mismatch, true);
  });

  it('rejects resolving a non-proposed assignment', async (t) => {
    const { service } = setup(t);
    const task = service.createTask({ title: 'A5', expertise_required: 'finance' });
    const [contrib] = service.listContributors();
    const assigned = await service.assignManual(task.id, contrib.id);
    service.acceptAssignment(assigned.current_assignment_id);
    assert.throws(() => service.declineAssignment(assigned.current_assignment_id), /only proposed assignments/);
  });
});
