# token-bucket

[![ci](https://github.com/p-vbordei/token-bucket/actions/workflows/ci.yml/badge.svg)](https://github.com/p-vbordei/token-bucket/actions/workflows/ci.yml)

[![npm](https://img.shields.io/npm/v/%40p-vbordei%2Ftoken-bucket.svg)](https://www.npmjs.com/package/@p-vbordei/token-bucket)
[![downloads](https://img.shields.io/npm/dm/%40p-vbordei%2Ftoken-bucket.svg)](https://www.npmjs.com/package/@p-vbordei/token-bucket)
[![bundle](https://img.shields.io/bundlejs/size/%40p-vbordei%2Ftoken-bucket)](https://bundlejs.com/?q=%40p-vbordei%2Ftoken-bucket)

> A correct, dependency-free token-bucket rate limiter. Single bucket or a keyed registry (per-IP, per-user, ...). Continuous refill, sync or async wait. Pluggable clock for tests.

```ts
import { TokenBucket, TokenBucketRegistry } from "@p-vbordei/token-bucket";

// Single bucket: 100-burst capacity, 10 tokens/sec steady-state
const b = new TokenBucket({ capacity: 100, refillPerSecond: 10 });

if (b.tryTake()) {
  // allowed
}

await b.take(1, /* timeoutMs */ 5000);  // waits until a token is free

// Per-key buckets (one bucket per IP, with idle eviction)
const reg = new TokenBucketRegistry({
  capacity: 100,
  refillPerSecond: 10,
  evictAfterMs: 10 * 60_000,
});

if (reg.tryTake(req.ip)) {
  // allowed
}
```

## Install

```sh
npm install @p-vbordei/token-bucket
```

Works with Node 20+, browsers, Bun, Deno. ESM + CJS.

## Why

Token bucket is the standard rate-limiting algorithm:

- A bucket holds up to `capacity` tokens
- Refills at `refillPerSecond` tokens/sec continuously
- Each request consumes one (or more) tokens
- Empty bucket → reject or wait

It naturally handles **burstiness** (the bucket can fill up to capacity, allowing a burst) and **steady-state limits** (long-term rate ≤ refillPerSecond).

Most rate-limit libraries are coupled to a framework or to Redis. This is a primitive — works the same in Express, Fastify, Hono, Cloudflare Workers, or as a client-side throttle.

## Recipes

### Express-style middleware (per-IP)

```ts
import { TokenBucketRegistry } from "@p-vbordei/token-bucket";

const reg = new TokenBucketRegistry({
  capacity: 60,           // burst of 60
  refillPerSecond: 1,     // 1 req/sec sustained
  evictAfterMs: 60 * 60_000,  // forget idle IPs after 1h
});

app.use((req, res, next) => {
  if (!reg.tryTake(req.ip)) {
    res.setHeader("Retry-After", "1");
    return res.status(429).send("Too Many Requests");
  }
  next();
});
```

### Client-side throttle for outbound API calls

```ts
import { TokenBucket } from "@p-vbordei/token-bucket";

// "50 requests per minute" → ~0.83/sec, allow burst of 10
const limiter = new TokenBucket({ capacity: 10, refillPerSecond: 50 / 60 });

async function callExternalApi() {
  await limiter.take();  // blocks until a token is free
  return await fetch(EXTERNAL);
}
```

### Per-user quota

```ts
import { TokenBucketRegistry } from "@p-vbordei/token-bucket";

const userLimits = new TokenBucketRegistry({
  capacity: 1000,         // 1000-token daily quota
  refillPerSecond: 1000 / 86400,  // refills over 24h
  evictAfterMs: 30 * 86_400_000,  // forget users idle > 30 days
});

if (!userLimits.tryTake(userId, expensiveCost)) {
  throw new Error("daily quota exceeded");
}
```

### "How long until I can?" hint

```ts
import { TokenBucket } from "@p-vbordei/token-bucket";

const b = new TokenBucket({ capacity: 10, refillPerSecond: 1 });

if (b.tryTake()) {
  doWork();
} else {
  const waitMs = b.msUntilAvailable();
  console.log(`Try again in ${waitMs}ms`);
}
```

### Inject clock for tests

```ts
import { TokenBucket } from "@p-vbordei/token-bucket";

class FakeClock {
  private t = 0;
  now = () => this.t;
  advance(ms: number) { this.t += ms; }
}

const clock = new FakeClock();
const b = new TokenBucket({ capacity: 5, refillPerSecond: 1, now: clock.now });
b.tryTake(5);
clock.advance(3000);
expect(b.peek()).toBe(3);
```

## API

### `new TokenBucket(config)`

| Field | Type | Default | Meaning |
|---|---|---|---|
| `capacity` | `number` | required | Max tokens (burst size) |
| `refillPerSecond` | `number` | required | Steady-state rate |
| `initialTokens` | `number` | `capacity` | Tokens at construction |
| `now` | `() => number` | `Date.now` | Injectable clock for tests |

Methods:

- `tryTake(n=1) → boolean` — consume `n` tokens if available, else return false without consuming
- `take(n=1, timeoutMs?) → Promise<void>` — wait until `n` tokens available, then consume; rejects if wait exceeds `timeoutMs`
- `msUntilAvailable(n=1) → number` — ms to wait for `n` tokens; `Infinity` if impossible
- `peek() → number` — current tokens (after applying refill)
- `reset() → void` — restore to full capacity

### `new TokenBucketRegistry(config)`

Extends `TokenBucket` config with `evictAfterMs?: number`. Buckets are created lazily per key (any value, hashed via `Map`).

Methods: `tryTake(key, n?)`, `take(key, n?, timeoutMs?)`, `msUntilAvailable(key, n?)`, `reset(key)`, `clear()`, `size()`, `sweep()`.

`sweep()` is called automatically on every `tryTake` / `take`; you can also call it on a timer.

## Notes

- Token counts are floating-point so refill is exact at any rate (e.g. 0.1 tokens/sec is fine).
- A bucket with `refillPerSecond: 0` and empty tokens will never satisfy further requests; `take()` will reject immediately rather than block forever.
- Both `take()` and `tryTake()` throw on `n <= 0`.

## Caveats

- **In-memory only.** For distributed rate limiting across instances, you need Redis or similar. The algorithm here is the right shape; use it inside your distributed implementation.
- **No backpressure on the producer.** If you have a producer pushing faster than the bucket refills, `take()` queues forever. Bound the producer too.

## License

Apache-2.0 © Vlad Bordei
