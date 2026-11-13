import { randomUUID } from 'node:crypto';
import { insertEvent } from './db.js';

const CONTRIBUTORS = [
  { name: 'Amara Okafor', expertise: ['finance', 'operations'] },
  { name: 'Daniel Reyes', expertise: ['healthcare', 'operations'] },
  { name: 'Priya Nair', expertise: ['data analysis', 'finance'] },
  { name: 'Tom Becker', expertise: ['operations'] },
  { name: 'Lena Fischer', expertise: ['healthcare', 'data analysis'] },
  { name: 'Marco Rossi', expertise: ['finance', 'data analysis'] },
];

const TASKS = [
  { title: 'Q3 revenue variance review', description: 'Explain the gap between forecast and actuals for Q3.', expertise: 'finance', priority: 'high' },
  { title: 'Patient intake bottleneck analysis', description: 'Find where intake slows down on busy mornings.', expertise: 'healthcare', priority: 'high' },
  { title: 'Churn cohort deep dive', description: 'Compare last quarter cohorts and flag drivers.', expertise: 'data analysis', priority: 'normal' },
  { title: 'Warehouse shift handover plan', description: 'Write a handover checklist for shift leads.', expertise: 'operations', priority: 'normal' },
  { title: 'Claims audit sampling', description: 'Pull a defensible sample for the quarterly audit.', expertise: 'finance', priority: 'normal' },
  { title: 'Trial site onboarding checklist', description: 'Prepare onboarding steps for two new sites.', expertise: 'healthcare', priority: 'low' },
  { title: 'Pricing experiment readout', description: 'Read out the A/B test and recommend next step.', expertise: 'data analysis', priority: 'high' },
  { title: 'Vendor escalation playbook', description: 'Document who to call when a vendor misses SLA.', expertise: 'operations', priority: 'low' },
];

export function seedRows(db) {
  const now = new Date().toISOString();
  for (const c of CONTRIBUTORS) {
    db.prepare('INSERT INTO contributors (id, name, expertise, created_at) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), c.name, JSON.stringify(c.expertise), now);
  }
  for (const t of TASKS) {
    const id = randomUUID();
    db.prepare(`INSERT INTO tasks
      (id, title, description, expertise_required, priority, status, current_assignment_id, generation, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, t.title, t.description, t.expertise, t.priority, 'draft', null, 0, now, now);
    insertEvent(db, id, 'task_created', {
      title: t.title, expertise_required: t.expertise, priority: t.priority, seeded: true,
    });
  }
  return { contributors: CONTRIBUTORS.length, tasks: TASKS.length };
}

export function seedIfEmpty(db) {
  const row = db.prepare('SELECT COUNT(*) AS n FROM contributors').get();
  if (row.n === 0) return seedRows(db);
  return null;
}
