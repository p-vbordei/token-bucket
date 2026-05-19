import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { TokenBucket } from "../src/index.js";

class FakeClock {
  private t = 0;
  now = () => this.t;
  advance(ms: number) { this.t += ms; }
}

describe("property: tokens never exceed capacity", () => {
  it("regardless of refill amount", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.float({ min: Math.fround(0.01), max: 100, noNaN: true }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (capacity, refillPerSecond, advanceMs) => {
          const clock = new FakeClock();
          const b = new TokenBucket({ capacity, refillPerSecond, initialTokens: 0, now: clock.now });
          clock.advance(advanceMs);
          expect(b.peek()).toBeLessThanOrEqual(capacity);
          expect(b.peek()).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});

describe("property: tryTake conserves tokens", () => {
  it("after take(n), peek() decreases by n (no refill time)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 100 }),
        (capacity, takeN) => {
          fc.pre(takeN <= capacity);
          const clock = new FakeClock();
          const b = new TokenBucket({ capacity, refillPerSecond: 0, now: clock.now });
          const before = b.peek();
          const ok = b.tryTake(takeN);
          expect(ok).toBe(true);
          expect(b.peek()).toBeCloseTo(before - takeN, 5);
        },
      ),
    );
  });
});
