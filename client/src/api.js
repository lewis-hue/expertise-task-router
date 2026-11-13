async function req(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return { body, cache: res.headers.get('x-cache') };
}

const post = (path, data) => req(path, { method: 'POST', body: JSON.stringify(data || {}) });

export const api = {
  overview: () => req('/api/overview'),
  tasks: () => req('/api/tasks'),
  taskDetail: (id) => req(`/api/tasks/${id}`),
  contributors: () => req('/api/contributors'),
  createTask: (data) => post('/api/tasks', data),
  createContributor: (data) => post('/api/contributors', data),
  submit: (id, scenario) => post(`/api/tasks/${id}/submit`, { scenario }),
  cancelRouting: (id) => post(`/api/tasks/${id}/cancel-routing`),
  assign: (id, contributor_id) => post(`/api/tasks/${id}/assign`, { contributor_id }),
  accept: (id) => post(`/api/assignments/${id}/accept`),
  decline: (id) => post(`/api/assignments/${id}/decline`),
  fail: (id) => post(`/api/assignments/${id}/fail`),
  reset: () => post('/api/admin/reset'),
};

export function age(iso, now) {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
