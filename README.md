# token-bucket

A correct, dependency-free token-bucket rate limiter. Single bucket or a keyed registry (per-IP, per-user, ...). Continuous refill, sync or async wait. Pluggable clock for tests.

```ts
import { TokenBucket, TokenBucketRegistry } from "token-bucket";

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
  evictAfterMs: 10 * 60_000,  // remove buckets idle > 10 min
});

if (reg.tryTake(req.ip)) {
  // allowed
}
```

## Install

```sh
npm install token-bucket
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

## License

Apache-2.0 © Vlad Bordei
