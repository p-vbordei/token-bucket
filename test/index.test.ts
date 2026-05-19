import { describe, it, expect } from "vitest";
import { TokenBucket, TokenBucketRegistry } from "../src/index.js";

class FakeClock {
  private t = 0;
  now = () => this.t;
  advance(ms: number) { this.t += ms; }
}

describe("TokenBucket basics", () => {
  it("starts full by default", () => {
    const clock = new FakeClock();
    const b = new TokenBucket({ capacity: 5, refillPerSecond: 1, now: clock.now });
    expect(b.peek()).toBe(5);
  });

  it("honors initialTokens", () => {
    const clock = new FakeClock();
    const b = new TokenBucket({ capacity: 5, refillPerSecond: 1, initialTokens: 2, now: clock.now });
    expect(b.peek()).toBe(2);
  });

  it("tryTake consumes when available", () => {
    const clock = new FakeClock();
    const b = new TokenBucket({ capacity: 5, refillPerSecond: 1, now: clock.now });
    expect(b.tryTake(3)).toBe(true);
    expect(b.peek()).toBe(2);
  });

  it("tryTake refuses when not enough", () => {
    const clock = new FakeClock();
    const b = new TokenBucket({ capacity: 5, refillPerSecond: 1, now: clock.now });
    b.tryTake(5);
    expect(b.tryTake(1)).toBe(false);
    expect(b.peek()).toBe(0);
  });

  it("refills continuously", () => {
    const clock = new FakeClock();
    const b = new TokenBucket({ capacity: 10, refillPerSecond: 2, initialTokens: 0, now: clock.now });
    expect(b.peek()).toBe(0);
    clock.advance(1000);
    expect(b.peek()).toBe(2);
    clock.advance(2500);
    expect(b.peek()).toBe(7);
  });

  it("caps refill at capacity", () => {
    const clock = new FakeClock();
    const b = new TokenBucket({ capacity: 5, refillPerSecond: 10, initialTokens: 0, now: clock.now });
    clock.advance(60_000);
    expect(b.peek()).toBe(5);
  });
});

describe("msUntilAvailable", () => {
  it("returns 0 when already available", () => {
    const clock = new FakeClock();
    const b = new TokenBucket({ capacity: 5, refillPerSecond: 1, now: clock.now });
    expect(b.msUntilAvailable(3)).toBe(0);
  });

  it("returns expected wait time", () => {
    const clock = new FakeClock();
    const b = new TokenBucket({ capacity: 10, refillPerSecond: 2, initialTokens: 0, now: clock.now });
    // need 4 tokens at 2/sec → 2 seconds
    expect(b.msUntilAvailable(4)).toBe(2000);
  });

  it("returns Infinity when n > capacity", () => {
    const clock = new FakeClock();
    const b = new TokenBucket({ capacity: 5, refillPerSecond: 1, now: clock.now });
    expect(b.msUntilAvailable(6)).toBe(Infinity);
  });

  it("returns Infinity when refill rate is 0 and tokens insufficient", () => {
    const clock = new FakeClock();
    const b = new TokenBucket({ capacity: 5, refillPerSecond: 0, initialTokens: 0, now: clock.now });
    expect(b.msUntilAvailable(1)).toBe(Infinity);
  });
});

describe("take (async)", () => {
  it("resolves immediately when available", async () => {
    const b = new TokenBucket({ capacity: 5, refillPerSecond: 1 });
    await expect(b.take(2)).resolves.toBeUndefined();
    expect(b.peek()).toBe(3);
  });

  it("rejects when wait would exceed timeoutMs", async () => {
    const b = new TokenBucket({ capacity: 1, refillPerSecond: 0.001, initialTokens: 0 });
    await expect(b.take(1, 50)).rejects.toThrow(/exceeds timeoutMs/);
  });

  it("waits then resolves", async () => {
    // capacity 1, refill 100/s → ~10ms wait
    const b = new TokenBucket({ capacity: 1, refillPerSecond: 100, initialTokens: 0 });
    const start = Date.now();
    await b.take(1);
    expect(Date.now() - start).toBeGreaterThanOrEqual(8);
  });
});

describe("validation", () => {
  it("rejects bad config", () => {
    expect(() => new TokenBucket({ capacity: 0, refillPerSecond: 1 })).toThrow();
    expect(() => new TokenBucket({ capacity: 1, refillPerSecond: -1 })).toThrow();
  });
  it("tryTake(0) throws", () => {
    const b = new TokenBucket({ capacity: 5, refillPerSecond: 1 });
    expect(() => b.tryTake(0)).toThrow();
  });
});

describe("reset", () => {
  it("restores to capacity", () => {
    const clock = new FakeClock();
    const b = new TokenBucket({ capacity: 5, refillPerSecond: 1, now: clock.now });
    b.tryTake(4);
    b.reset();
    expect(b.peek()).toBe(5);
  });
});

describe("TokenBucketRegistry", () => {
  it("creates separate buckets per key", () => {
    const clock = new FakeClock();
    const reg = new TokenBucketRegistry({ capacity: 2, refillPerSecond: 0, now: clock.now });
    expect(reg.tryTake("a")).toBe(true);
    expect(reg.tryTake("a")).toBe(true);
    expect(reg.tryTake("a")).toBe(false);
    expect(reg.tryTake("b")).toBe(true);
  });

  it("evicts idle buckets", () => {
    const clock = new FakeClock();
    const reg = new TokenBucketRegistry({ capacity: 2, refillPerSecond: 1, evictAfterMs: 1000, now: clock.now });
    reg.tryTake("a");
    reg.tryTake("b");
    expect(reg.size()).toBe(2);
    clock.advance(2000);
    reg.sweep();
    expect(reg.size()).toBe(0);
  });

  it("clear empties", () => {
    const reg = new TokenBucketRegistry({ capacity: 2, refillPerSecond: 1 });
    reg.tryTake("a");
    reg.tryTake("b");
    reg.clear();
    expect(reg.size()).toBe(0);
  });
});
