import { Readable } from 'node:stream';

// Drive a real Express app without binding a socket (sandbox-friendly).
// Exercises actual routing, middleware, handlers, and error mapping.
export function request(app, method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = new Readable({ read() {}, destroy(err, cb) { cb(err); } });
    req.method = method;
    req.url = path;
    req.headers = { host: 'test' };
    if (payload) {
      req.headers['content-type'] = 'application/json';
      req.headers['content-length'] = String(payload.length);
    }
    req.socket = { remoteAddress: '127.0.0.1' };

    const chunks = [];
    const headers = {};
    const res = {
      statusCode: 200,
      locals: {},
      setHeader(k, v) { headers[String(k).toLowerCase()] = v; },
      getHeader(k) { return headers[String(k).toLowerCase()]; },
      getHeaders() { return { ...headers }; },
      hasHeader(k) { return String(k).toLowerCase() in headers; },
      removeHeader(k) { delete headers[String(k).toLowerCase()]; },
      write(c) { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); return true; },
      end(c) {
        if (c) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = raw;
        if ((headers['content-type'] || '').includes('application/json') && raw) {
          try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        }
        resolve({ status: res.statusCode, headers, body: parsed });
      },
    };
    res.req = req;
    req.res = res;
    try {
      app.handle(req, res, (err) => {
        if (err) reject(err);
        else resolve({ status: 404, headers, body: null });
      });
      setImmediate(() => {
        if (payload) req.push(payload);
        req.push(null);
      });
    } catch (err) {
      reject(err);
    }
  });
}
