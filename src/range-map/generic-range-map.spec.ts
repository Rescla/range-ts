import { BoundType } from "../core/bound-type";
import { BigIntPoint, bigintScalar } from "../core/scalars";
import { defineRange } from "../range/range";
import { RangeMap } from "./range-map";

const R = defineRange(bigintScalar);
const b = (n: number) => BigInt(n);

/**
 * Generic `RangeMap<T, P>` behaviour over an exact point domain. The split/merge
 * cases here are where an OPEN-vs-CLOSED slip silently swallows or strands a
 * single point, which on an id domain is exactly the bug that costs you one
 * record and never shows up in a smoke test.
 */
describe("RangeMap<T, P> over an exact domain", () => {
  describe("put versus putCoalescing", () => {
    it("put keeps adjacent equal-valued ranges separate", () => {
      const m = new RangeMap<string, BigIntPoint>();
      m.put(R.closed(b(1), b(5)), "a");
      m.put(R.closed(b(6), b(9)), "a");
      expect(m.asMapOfRanges().size).toBe(2);
    });

    it("put does not merge an overlapping equal-valued range", () => {
      const m = new RangeMap<string, BigIntPoint>();
      m.put(R.closed(b(1), b(5)), "a");
      m.put(R.closed(b(4), b(9)), "a");
      // Non-coalescing: the surviving head of the old entry stays as its own entry.
      expect(m.asMapOfRanges().size).toBe(2);
      expect(m.get(b(2))).toBe("a");
      expect(m.get(b(7))).toBe("a");
    });

    it("putCoalescing merges an overlapping equal-valued range into one", () => {
      const m = new RangeMap<string, BigIntPoint>();
      m.putCoalescing(R.closed(b(1), b(5)), "a");
      m.putCoalescing(R.closed(b(4), b(9)), "a");
      expect(m.asMapOfRanges().size).toBe(1);
      expect([...m.asMapOfRanges().keys()][0].toString()).toBe("[1..9]");
    });

    it("putCoalescing does not bridge a gap, because adjacency is not connection", () => {
      // isConnected() is false for [1..5] and [6..9] even on a discrete scalar,
      // so coalescing has nothing to merge across the seam.
      const m = new RangeMap<string, BigIntPoint>();
      m.putCoalescing(R.closed(b(1), b(5)), "a");
      m.putCoalescing(R.closed(b(6), b(9)), "a");
      expect(m.asMapOfRanges().size).toBe(2);
    });

    it("putCoalescing still keeps different values apart", () => {
      const m = new RangeMap<string, BigIntPoint>();
      m.putCoalescing(R.closed(b(1), b(5)), "a");
      m.putCoalescing(R.closed(b(4), b(9)), "b");
      expect(m.asMapOfRanges().size).toBe(2);
      expect(m.get(b(2))).toBe("a");
      expect(m.get(b(7))).toBe("b");
    });
  });

  describe("getEntry", () => {
    it("returns the containing range and its value together", () => {
      const m = new RangeMap<string, BigIntPoint>();
      m.put(R.closed(b(1), b(5)), "a");
      const entry = m.getEntry(b(3));
      expect(entry).not.toBeNull();
      expect(entry![1]).toBe("a");
      expect(entry![0].toString()).toBe("[1..5]");
    });

    it("returns null for a key in no range", () => {
      const m = new RangeMap<string, BigIntPoint>();
      m.put(R.closed(b(1), b(5)), "a");
      expect(m.getEntry(b(99))).toBeNull();
      expect(m.getEntry(b(6))).toBeNull();
    });

    it("respects an open lower bound at the boundary", () => {
      const m = new RangeMap<string, BigIntPoint>();
      m.put(R.open(b(1), b(5)), "a");
      expect(m.getEntry(b(1))).toBeNull();
      expect(m.getEntry(b(2))).not.toBeNull();
    });
  });

  describe("span", () => {
    it("is null on an empty map", () => {
      expect(new RangeMap<string, BigIntPoint>().span()).toBeNull();
    });

    it("covers from the lowest low to the highest high", () => {
      const m = new RangeMap<string, BigIntPoint>();
      m.put(R.closed(b(10), b(20)), "a");
      m.put(R.closed(b(1), b(5)), "b");
      expect(m.span()!.toString()).toBe("[1..20]");
    });

    it("is the single range when there is one entry", () => {
      const m = new RangeMap<string, BigIntPoint>();
      m.put(R.closedOpen(b(3), b(4)), "a");
      expect(m.span()!.toString()).toBe("[3..4)");
    });
  });

  describe("remove", () => {
    it("is a no-op for an empty range", () => {
      const m = new RangeMap<string, BigIntPoint>();
      m.put(R.closed(b(1), b(5)), "a");
      m.remove(R.closedOpen(b(3), b(3)));
      expect(m.asMapOfRanges().size).toBe(1);
      expect(m.get(b(3))).toBe("a");
    });

    it("splits an entry, leaving both untouched parts", () => {
      const m = new RangeMap<string, BigIntPoint>();
      m.put(R.closed(b(1), b(10)), "a");
      m.remove(R.closed(b(4), b(6)));
      expect(m.asMapOfRanges().size).toBe(2);
      expect(m.get(b(3))).toBe("a");
      expect(m.get(b(4))).toBeNull();
      expect(m.get(b(6))).toBeNull();
      expect(m.get(b(7))).toBe("a");
    });

    it("leaves the boundary points when the removed range is open", () => {
      const m = new RangeMap<string, BigIntPoint>();
      m.put(R.closed(b(1), b(10)), "a");
      m.remove(R.open(b(1), b(10)));
      expect(m.get(b(1))).toBe("a");
      expect(m.get(b(5))).toBeNull();
      expect(m.get(b(10))).toBe("a");
    });

    it("removes exactly one endpoint when the removal is closed-open", () => {
      const m = new RangeMap<string, BigIntPoint>();
      m.put(R.closed(b(1), b(10)), "a");
      m.remove(R.closedOpen(b(1), b(10)));
      expect(m.get(b(1))).toBeNull();
      expect(m.get(b(9))).toBeNull();
      expect(m.get(b(10))).toBe("a");
    });

    it("removes everything", () => {
      const m = new RangeMap<string, BigIntPoint>();
      m.put(R.closed(b(1), b(5)), "a");
      m.put(R.closed(b(7), b(9)), "b");
      m.remove(R.all());
      expect(m.asMapOfRanges().size).toBe(0);
      expect(m.span()).toBeNull();
    });
  });

  describe("put over existing entries", () => {
    it("honours an open boundary when overwriting the middle", () => {
      const m = new RangeMap<string, BigIntPoint>();
      m.put(R.closed(b(1), b(10)), "a");
      m.put(R.open(b(3), b(7)), "b");
      expect(m.get(b(3))).toBe("a");
      expect(m.get(b(4))).toBe("b");
      expect(m.get(b(6))).toBe("b");
      expect(m.get(b(7))).toBe("a");
    });

    it("honours a closed boundary when overwriting the middle", () => {
      const m = new RangeMap<string, BigIntPoint>();
      m.put(R.closed(b(1), b(10)), "a");
      m.put(R.closed(b(3), b(7)), "b");
      expect(m.get(b(2))).toBe("a");
      expect(m.get(b(3))).toBe("b");
      expect(m.get(b(7))).toBe("b");
      expect(m.get(b(8))).toBe("a");
    });

    it("overwrites a whole entry and keeps neighbours", () => {
      const m = new RangeMap<string, BigIntPoint>();
      m.put(R.closed(b(1), b(4)), "a");
      m.put(R.closed(b(5), b(8)), "b");
      m.put(R.closed(b(5), b(8)), "c");
      expect(m.get(b(2))).toBe("a");
      expect(m.get(b(6))).toBe("c");
      expect(m.asMapOfRanges().size).toBe(2);
    });
  });

  describe("subRangeMap", () => {
    it("clips entries to the requested window", () => {
      const m = new RangeMap<string, BigIntPoint>();
      m.put(R.closed(b(1), b(10)), "a");
      const sub = m.subRangeMap(R.closed(b(3), b(6)));
      expect([...sub.asMapOfRanges().keys()][0].toString()).toBe("[3..6]");
      expect(sub.get(b(2))).toBeNull();
      expect(sub.get(b(4))).toBe("a");
    });

    it("keeps the tighter bound when clipping at an open edge", () => {
      const m = new RangeMap<string, BigIntPoint>();
      m.put(R.closed(b(1), b(10)), "a");
      const sub = m.subRangeMap(R.open(b(1), b(10)));
      expect(sub.get(b(1))).toBeNull();
      expect(sub.get(b(2))).toBe("a");
      expect(sub.get(b(10))).toBeNull();
    });
  });

  describe("asMapOfValues", () => {
    it("groups the ranges that share a value", () => {
      const m = new RangeMap<string, BigIntPoint>();
      m.put(R.closed(b(1), b(2)), "a");
      m.put(R.closed(b(5), b(6)), "b");
      m.put(R.closed(b(9), b(10)), "a");
      const byValue = m.asMapOfValues();
      expect(byValue.get("a")!.length).toBe(2);
      expect(byValue.get("b")!.length).toBe(1);
      expect(byValue.get("a")!.map((r) => r.toString())).toEqual(["[1..2]", "[9..10]"]);
    });
  });

  describe("bound type reaches the stored ranges", () => {
    it("preserves a downTo-anchored entry through put and getEntry", () => {
      const m = new RangeMap<string, BigIntPoint>();
      m.put(R.downTo(b(100), BoundType.CLOSED), "tail");
      const entry = m.getEntry(b(1000));
      expect(entry).not.toBeNull();
      expect(entry![1]).toBe("tail");
      expect(entry![0].isBoundedAbove()).toBe(false);
      expect(entry![0].lowerEndpointOrThrow()).toBe(b(100));
    });
  });
});
