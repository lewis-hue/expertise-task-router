import IORedis from 'ioredis';

export function createCache(redisUrl) {
  if (!redisUrl) {
    return {
      type: 'none',
      async get() { return null; },
      async set() {},
      async del() {},
      async close() {},
    };
  }
  const redis = new IORedis(redisUrl);
  let warned = false;
  redis.on('error', (err) => {
    if (!warned) {
      warned = true;
      console.log(`cache redis error (continuing without cache): ${err?.message}`);
    }
  });
  return {
    type: 'redis',
    async get(key) {
      try {
        const raw = await redis.get(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    async set(key, value, ttlSec) {
      try {
        await redis.set(key, JSON.stringify(value), 'EX', ttlSec);
      } catch {
        // fail open: a cache write must never break the request
      }
    },
    async del(...keys) {
      try {
        if (keys.length > 0) await redis.del(...keys);
      } catch {
        // fail open
      }
    },
    async close() {
      redis.disconnect();
    },
  };
}
