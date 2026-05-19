export interface TokenBucketConfig {
  /** Maximum tokens the bucket can hold (burst capacity). */
  capacity: number;
  /** Tokens added per second (steady-state rate). */
  refillPerSecond: number;
  /** Tokens at construction time. Defaults to `capacity`. */
  initialTokens?: number;
  /** Injectable clock returning unix ms. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Classic token-bucket rate limiter. One instance = one bucket.
 *
 * `tryTake(n)` returns `true` if `n` tokens were available (and consumes them),
 * `false` otherwise. Tokens accumulate continuously at `refillPerSecond` up to
 * `capacity`.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;
  readonly capacity: number;
  readonly refillPerSecond: number;
  private readonly clock: () => number;

  constructor(config: TokenBucketConfig) {
    if (config.capacity <= 0) throw new Error("capacity must be > 0");
    if (config.refillPerSecond < 0) throw new Error("refillPerSecond must be >= 0");
    this.capacity = config.capacity;
    this.refillPerSecond = config.refillPerSecond;
    this.clock = config.now ?? Date.now;
    this.tokens = Math.min(config.initialTokens ?? config.capacity, config.capacity);
    this.lastRefillMs = this.clock();
  }

  private refill(): void {
    const now = this.clock();
    const elapsed = (now - this.lastRefillMs) / 1000;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
    this.lastRefillMs = now;
  }

  /** Returns the number of available tokens after applying refill. Does not consume anything. */
  peek(): number {
    this.refill();
    return this.tokens;
  }

  /** Consume `n` tokens if available; otherwise return false without consuming. */
  tryTake(n = 1): boolean {
    if (n <= 0) throw new Error("n must be > 0");
    this.refill();
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }

  /**
   * Milliseconds until `n` tokens will be available. Returns 0 if already available.
   * Returns `Infinity` if `n > capacity` (impossible to ever satisfy) or refill rate is 0.
   */
  msUntilAvailable(n = 1): number {
    if (n <= 0) throw new Error("n must be > 0");
    if (n > this.capacity) return Infinity;
    this.refill();
    if (this.tokens >= n) return 0;
    if (this.refillPerSecond === 0) return Infinity;
    const deficit = n - this.tokens;
    return Math.ceil((deficit / this.refillPerSecond) * 1000);
  }

  /**
   * Wait until `n` tokens are available, then consume them.
   * Rejects with an Error if it would require more than `timeoutMs`.
   */
  take(n = 1, timeoutMs?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const attempt = () => {
        if (this.tryTake(n)) {
          resolve();
          return;
        }
        const wait = this.msUntilAvailable(n);
        if (!Number.isFinite(wait)) {
          reject(new Error("token bucket can never satisfy request"));
          return;
        }
        if (timeoutMs !== undefined && wait > timeoutMs) {
          reject(new Error(`would block ${wait}ms, exceeds timeoutMs=${timeoutMs}`));
          return;
        }
        setTimeout(attempt, wait + 1);
      };
      attempt();
    });
  }

  /** Reset to full capacity. */
  reset(): void {
    this.tokens = this.capacity;
    this.lastRefillMs = this.clock();
  }
}

/**
 * A keyed registry of token buckets — one bucket per key (e.g. per IP, per user).
 * Buckets are lazily created with the same config.
 *
 * Includes an optional idle-eviction sweeper so unused buckets do not leak memory.
 */
export interface RegistryConfig extends TokenBucketConfig {
  /** Remove buckets idle for this many ms. Default: never. */
  evictAfterMs?: number;
}

export class TokenBucketRegistry<K = string> {
  private readonly buckets = new Map<K, { bucket: TokenBucket; lastUsedMs: number }>();
  private readonly cfg: RegistryConfig;

  constructor(cfg: RegistryConfig) {
    this.cfg = cfg;
  }

  private now(): number {
    return (this.cfg.now ?? Date.now)();
  }

  private getOrCreate(key: K): TokenBucket {
    const existing = this.buckets.get(key);
    if (existing) {
      existing.lastUsedMs = this.now();
      return existing.bucket;
    }
    const bucket = new TokenBucket(this.cfg);
    this.buckets.set(key, { bucket, lastUsedMs: this.now() });
    return bucket;
  }

  tryTake(key: K, n = 1): boolean {
    this.sweep();
    return this.getOrCreate(key).tryTake(n);
  }

  msUntilAvailable(key: K, n = 1): number {
    return this.getOrCreate(key).msUntilAvailable(n);
  }

  take(key: K, n = 1, timeoutMs?: number): Promise<void> {
    this.sweep();
    return this.getOrCreate(key).take(n, timeoutMs);
  }

  reset(key: K): void {
    this.buckets.get(key)?.bucket.reset();
  }

  clear(): void {
    this.buckets.clear();
  }

  size(): number {
    return this.buckets.size;
  }

  /** Manually evict idle buckets. Automatically invoked on each call. */
  sweep(): number {
    const ttl = this.cfg.evictAfterMs;
    if (ttl === undefined) return 0;
    const cutoff = this.now() - ttl;
    let evicted = 0;
    for (const [k, v] of this.buckets) {
      if (v.lastUsedMs < cutoff) {
        this.buckets.delete(k);
        evicted++;
      }
    }
    return evicted;
  }
}
