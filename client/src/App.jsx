import { useCallback, useEffect, useRef, useState } from 'react';
import { api, age } from './api.js';
import TaskDetail, { EVENT_LABELS } from './TaskDetail.jsx';

const STATUS_LABELS = {
  draft: 'Draft', routing: 'Routing', proposed: 'Proposed', accepted: 'Accepted',
  declined: 'Declined', failed: 'Failed', no_match: 'No match', cancelled: 'Cancelled',
};
const STATUSES = Object.keys(STATUS_LABELS);

function Pill({ status }) {
  return <span className={`pill st-${status}`}>{STATUS_LABELS[status] || status}</span>;
}

function TaskRow({ t, now, selected, pastMs, scenario, onSelect, onSubmit }) {
  const routingMs = t.pending_attempt ? now - Date.parse(t.pending_attempt.created_at) : 0;
  const submittable = ['draft', 'declined', 'failed', 'no_match'].includes(t.status);
  return (
    <li className={selected ? 'task selected' : 'task'} onClick={onSelect}>
      <div className="task-top">
        <span className="task-title">{t.title}</span>
        <Pill status={t.status} />
      </div>
      <div className="task-meta">
        <span className={`prio pr-${t.priority}`}>{t.priority}</span>
        <span className="tag">{t.expertise_required}</span>
        <span className="muted">{age(t.created_at, now)} old</span>
      </div>
      <div className="task-meta">
        {t.current_assignee ? <span>→ {t.current_assignee.name}</span> : <span className="muted">unassigned</span>}
        {t.pending_attempt && (
          <span className={routingMs > pastMs ? 'warn' : 'muted'}>
            routing {age(t.pending_attempt.created_at, now)}
            {routingMs > pastMs ? ' · past normal window' : ''}
          </span>
        )}
      </div>
      {submittable && (
        <button className="btn small" onClick={(e) => { e.stopPropagation(); onSubmit(); }}>
          Submit · {scenario}
        </button>
      )}
    </li>
  );
}

export default function App() {
  const [overview, setOverview] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [contributors, setContributors] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [scenario, setScenario] = useState('auto');
  const [cacheHint, setCacheHint] = useState(null);
  const [error, setError] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const selRef = useRef(null);

  const select = (id) => { selRef.current = id; setSelectedId(id); };

  const refresh = useCallback(async () => {
    try {
      const [ov, ts, cs] = await Promise.all([api.overview(), api.tasks(), api.contributors()]);
      setOverview(ov.body);
      setCacheHint(ov.cache);
      setTasks(ts.body);
      setContributors(cs.body);
      if (selRef.current) {
        try {
          setDetail((await api.taskDetail(selRef.current)).body);
        } catch {
          selRef.current = null;
          setSelectedId(null);
          setDetail(null);
        }
      }
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, 2000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [refresh]);

  const run = async (fn) => {
    try {
      setError(null);
      await fn();
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  const counts = overview?.task_counts || {};
  const queue = overview?.queue || null;
  const pastMs = queue?.normal_window_ms || 20000;

  return (
    <div className="app">
      <header className="topbar">
        <h1>Terac <span className="muted">· Operator Console</span></h1>
        <div className="top-actions">
          <span className="cache" title="Overview responses are cached in Redis for 5 seconds">cache {cacheHint || '…'}</span>
          <button
            className="btn danger-ghost"
            onClick={() => {
              if (window.confirm('Reset demo data? This clears all tasks and reseeds.')) {
                run(async () => {
                  await api.reset();
                  selRef.current = null;
                  setSelectedId(null);
                  setDetail(null);
                });
              }
            }}
          >
            Reset demo
          </button>
        </div>
      </header>

      {error && (
        <div className="error">
          <span>{error}</span>
          <button className="btn small" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <section className="strip" aria-label="Operation state">
        {STATUSES.map((s) => (
          <span key={s} className="stat"><strong>{counts[s] || 0}</strong>{STATUS_LABELS[s].toLowerCase()}</span>
        ))}
        <span className={overview?.past_normal_window ? 'stat alert' : 'stat'}>
          <strong>{overview?.routing_pending || 0}</strong>routing
          {!!overview?.past_normal_window && ` (${overview.past_normal_window} past window)`}
        </span>
        <span className="stat"><strong>{overview?.active_assignments || 0}</strong>active assignments</span>
      </section>

      {queue && (
        <section className="strip" aria-label="Workers">
          <span className="stat"><strong>{queue.scheduler === 'bullmq' ? 'Redis queue' : 'In-process'}</strong>engine</span>
          <span className="stat"><strong>{queue.waiting}</strong>waiting</span>
          <span className="stat"><strong>{queue.active}</strong>active</span>
          <span className="stat"><strong>{queue.delayed}</strong>delayed</span>
          <span className="stat"><strong>{queue.workers?.length || 0}</strong>workers{queue.workers?.length ? ` (×${queue.worker_concurrency})` : ''}</span>
        </section>
      )}

      <main className="layout">
        <section className="card">
          <div className="row between">
            <h2>Tasks</h2>
            <button className="btn small" onClick={() => setShowNew((v) => !v)}>
              {showNew ? 'Close' : 'New task'}
            </button>
          </div>
          {showNew && (
            <NewTaskForm
              areas={[...new Set(contributors.flatMap((c) => c.expertise))]}
              onDone={(created) => { setShowNew(false); if (created) select(created.id); }}
              run={run}
            />
          )}
          <div className="row">
            <label className="muted small" htmlFor="scenario">Quick-submit mode</label>
            <select id="scenario" value={scenario} onChange={(e) => setScenario(e.target.value)}>
              <option value="auto">auto</option>
              <option value="fast-match">fast-match</option>
              <option value="no-match">no-match</option>
              <option value="never">never</option>
            </select>
          </div>
          <ul className="tasklist">
            {tasks.map((t) => (
              <TaskRow
                key={t.id}
                t={t}
                now={now}
                selected={t.id === selectedId}
                pastMs={pastMs}
                scenario={scenario}
                onSelect={() => select(t.id)}
                onSubmit={() => run(() => api.submit(t.id, scenario))}
              />
            ))}
          </ul>
          {tasks.length === 0 && <p className="muted">No tasks yet.</p>}
        </section>

        <section className="card">
          <h2>Detail</h2>
          {!detail && <p className="muted">Select a task to inspect assignments, routing attempts, and history.</p>}
          {detail && (
            <TaskDetail
              key={detail.task.id}
              detail={detail}
              contributors={contributors}
              now={now}
              scenario={scenario}
              setScenario={setScenario}
              run={run}
              pastMs={pastMs}
            />
          )}
        </section>
      </main>

      <div className="layout bottom">
        <section className="card">
          <h2>Contributors</h2>
          <ul className="people">
            {contributors.map((c) => (
              <li key={c.id}>
                <strong>{c.name}</strong>
                <span className="muted small"> · {c.proposed_count} proposed · {c.accepted_count} accepted</span>
                <div className="task-meta">
                  {c.expertise.map((e) => (<span key={e} className="tag">{e}</span>))}
                </div>
              </li>
            ))}
          </ul>
          <AddContributorForm run={run} />
        </section>

        <section className="card">
          <h2>Recent activity</h2>
          <ol className="timeline">
            {(overview?.recent_events || []).map((e) => (
              <li key={e.id}>
                <span className="muted">{new Date(e.created_at).toLocaleTimeString()}</span>{' '}
                <button className="link" onClick={() => select(e.task_id)}>{e.task_title}</button>{' '}
                {EVENT_LABELS[e.type] || e.type}
              </li>
            ))}
          </ol>
          {(overview?.recent_events || []).length === 0 && <p className="muted">No activity yet.</p>}
        </section>
      </div>

      <details className="card how">
        <summary>How routing works here</summary>
        <ul>
          <li>Submitting starts a background routing job: normally 5–20s, and 20% never return — silently.</li>
          <li>Slow and stuck look identical, so pending work is never auto-failed. Elapsed time and a past-window flag are shown instead.</li>
          <li>You can intervene any time: cancel routing, retry, or assign manually. A late engine answer never overwrites your decision; it lands in history.</li>
          <li>At most one active assignee per task. Accepting ends routing; declining or failing reopens the task for recovery.</li>
          <li>Refresh is safe (all state is server-side). A restart reopens in-flight routing as actionable history.</li>
        </ul>
      </details>
    </div>
  );
}

function NewTaskForm({ areas, onDone, run }) {
  const [title, setTitle] = useState('');
  const [expertise, setExpertise] = useState(areas[0] || '');
  const [priority, setPriority] = useState('normal');
  const [description, setDescription] = useState('');
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const { body } = await api.createTask({ title, expertise_required: expertise, priority, description });
          onDone(body);
        });
      }}
    >
      <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <div className="row">
        <input placeholder="Expertise needed" value={expertise} onChange={(e) => setExpertise(e.target.value)} list="areas" required />
        <datalist id="areas">
          {areas.map((a) => (<option key={a} value={a} />))}
        </datalist>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
          <option value="low">low</option>
          <option value="normal">normal</option>
          <option value="high">high</option>
        </select>
      </div>
      <input placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
      <button className="btn primary" type="submit">Create task</button>
    </form>
  );
}

function AddContributorForm({ run }) {
  const [name, setName] = useState('');
  const [expertise, setExpertise] = useState('');
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          await api.createContributor({ name, expertise: expertise.split(',').map((s) => s.trim()).filter(Boolean) });
          setName('');
          setExpertise('');
        });
      }}
    >
      <div className="row">
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input placeholder="Expertise, comma separated" value={expertise} onChange={(e) => setExpertise(e.target.value)} required />
        <button className="btn small" type="submit">Add</button>
      </div>
    </form>
  );
}
