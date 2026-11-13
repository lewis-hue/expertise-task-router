import { useState } from 'react';
import { api, age } from './api.js';

export const EVENT_LABELS = {
  task_created: 'Task created',
  routing_submitted: 'Submitted for routing',
  routing_matched: 'Routing matched',
  routing_no_match: 'Routing found no match',
  routing_cancelled: 'Routing cancelled',
  routing_superseded_by_operator: 'Routing superseded by operator',
  routing_late_return_ignored: 'Late routing return ignored',
  routing_interrupted: 'Routing interrupted by restart',
  assignment_proposed: 'Assignment proposed',
  assignment_superseded: 'Assignment superseded',
  assignment_accepted: 'Assignment accepted',
  assignment_declined: 'Assignment declined',
  assignment_failed: 'Assignment failed',
};

function EventDetail({ detail }) {
  const d = detail || {};
  const bits = [];
  if (d.scenario) bits.push(`mode: ${d.scenario}`);
  if (d.scheduled === false) bits.push('no worker timer');
  if (d.eligible) bits.push(`${d.eligible.length} eligible`);
  if (d.contributor_name) bits.push(d.contributor_name);
  if (d.source) bits.push(`via ${d.source}`);
  if (d.mismatch) bits.push('expertise mismatch');
  if (d.reason) bits.push(d.reason);
  if (d.by) bits.push(`by ${d.by}`);
  if (bits.length === 0) return null;
  return <span className="muted"> — {bits.join(' · ')}</span>;
}

const SUBMITTABLE = ['draft', 'declined', 'failed', 'no_match'];
const normalizeExpertise = (area) => String(area ?? '').trim().toLowerCase();

export default function TaskDetail({ detail, contributors, now, scenario, setScenario, run, pastMs }) {
  const { task, assignments, attempts, events } = detail;
  const requiredExpertise = normalizeExpertise(task.expertise_required);
  const eligible = contributors.filter((c) =>
    c.expertise.some((area) => normalizeExpertise(area) === requiredExpertise));
  const [assignee, setAssignee] = useState(() => (eligible[0] || contributors[0] || {}).id || '');
  const routingMs = task.pending_attempt ? now - Date.parse(task.pending_attempt.created_at) : 0;

  return (
    <div>
      <div className="detail-head">
        <div>
          <h2>{task.title}</h2>
          <div className="task-meta">
            <span className={`prio pr-${task.priority}`}>{task.priority}</span>
            <span className="tag">{task.expertise_required}</span>
            <span className="muted">{age(task.created_at, now)} old</span>
          </div>
        </div>
      </div>
      {task.description && <p className="desc">{task.description}</p>}

      {task.status === 'routing' && task.pending_attempt && (
        <div className="callout">
          <strong>Routing for {age(task.pending_attempt.created_at, now)}</strong>
          <span className="muted"> — slow and stuck look identical; no auto-fail. </span>
          {routingMs > pastMs && <span className="warn">Past the normal {Math.round(pastMs / 1000)}s window.</span>}
          <div className="row">
            <button className="btn small" onClick={() => run(() => api.cancelRouting(task.id))}>Cancel routing</button>
          </div>
        </div>
      )}

      {SUBMITTABLE.includes(task.status) && (
        <div className="panel">
          <h3>Submit for assignment</h3>
          <div className="row">
            <select value={scenario} onChange={(e) => setScenario(e.target.value)} aria-label="Routing mode">
              <option value="auto">Auto (5–20s, may never return)</option>
              <option value="fast-match">Fast match (demo)</option>
              <option value="no-match">Force no match (demo)</option>
              <option value="never">Never returns (demo)</option>
            </select>
            <button className="btn primary" onClick={() => run(() => api.submit(task.id, scenario))}>Submit</button>
          </div>
          <p className="muted small">Auto mirrors the real engine. Demo modes make each outcome reproducible.</p>
        </div>
      )}

      {!['accepted', 'cancelled'].includes(task.status) && (
        <div className="panel">
          <h3>Assign manually</h3>
          <div className="row">
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Contributor">
              {contributors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{eligible.some((e) => e.id === c.id) ? '' : ' (no match)'}
                </option>
              ))}
            </select>
            <button className="btn" onClick={() => run(() => api.assign(task.id, assignee))}>Assign</button>
          </div>
          <p className="muted small">Works any time, including mid-routing. Pending engine work is superseded, never applied late.</p>
        </div>
      )}

      <div className="panel">
        <h3>Assignments</h3>
        {assignments.length === 0 && <p className="muted">None yet.</p>}
        {assignments.map((a) => (
          <div key={a.id} className="assign">
            <div className="row between">
              <strong>{a.contributor ? a.contributor.name : 'Unknown'}</strong>
              <span className={`pill st-${a.status}`}>{a.status}</span>
            </div>
            <div className="task-meta">
              <span className="muted">via {a.source}</span>
              <span className="muted">{age(a.created_at, now)} old</span>
              {a.mismatch && <span className="warn">expertise mismatch</span>}
            </div>
            {a.status === 'proposed' && (
              <div className="row">
                <button className="btn small primary" onClick={() => run(() => api.accept(a.id))}>Record accept</button>
                <button className="btn small" onClick={() => run(() => api.decline(a.id))}>Record decline</button>
                <button className="btn small" onClick={() => run(() => api.fail(a.id))}>Record failure</button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="panel">
        <h3>Routing attempts</h3>
        {attempts.length === 0 && <p className="muted">None yet.</p>}
        {attempts.map((a, i) => (
          <div key={a.id} className="attempt">
            <div className="row between">
              <strong>Attempt {i + 1} <span className="muted">· {a.scenario}</span></strong>
              <span className={`pill st-${a.status}`}>{a.status.replace('_', ' ')}</span>
            </div>
            <div className="task-meta">
              <span className="muted">
                {a.eligible.length > 0 ? `eligible: ${a.eligible.map((e) => e.name).join(', ')}` : 'no eligible contributors'}
              </span>
            </div>
            {a.chosen_contributor && <div className="task-meta"><span>chose {a.chosen_contributor.name}</span></div>}
          </div>
        ))}
      </div>

      <div className="panel">
        <h3>History</h3>
        <ol className="timeline">
          {events.map((e) => (
            <li key={e.id}>
              <span className="muted">{new Date(e.created_at).toLocaleTimeString()}</span>{' '}
              {EVENT_LABELS[e.type] || e.type}
              <EventDetail detail={e.detail} />
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
