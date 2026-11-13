import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

describe('restart recovery', () => {
  it('sweep reopens in-flight routing as actionable history', async (t) => {
    const { service } = setup(t);
    const task = service.createTask({ title: 'R1', expertise_required: 'finance' });
    await service.submitTask(task.id, 'never');
    const sweep = await service.sweepInterrupted();
    assert.equal(sweep.interruptedAttempts, 1);
    assert.equal(sweep.tasksReopened, 1);
    const d = service.getTaskDetail(task.id);
    assert.equal(d.task.status, 'draft');
    assert.equal(d.attempts[0].status, 'interrupted');
    assert.ok(d.events.some((e) => e.type === 'routing_interrupted'));
    const resubmitted = await service.submitTask(task.id, 'fast-match');
    assert.equal(resubmitted.task.status, 'routing');
  });

  it('sweep is a no-op without pending attempts', async (t) => {
    const { service } = setup(t);
    const sweep = await service.sweepInterrupted();
    assert.deepEqual(sweep, { interruptedAttempts: 0, tasksReopened: 0 });
  });
});
