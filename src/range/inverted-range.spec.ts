import { BoundType } from "../core/bound-type";
import { BigIntPoint, bigintScalar, numberScalar } from "../core/scalars";
import { NumberRange } from "../number-range/number-range";
import { RangeMap } from "../range-map/range-map";
import { Range, defineRange } from "./range";

const R = defineRange(bigintScalar);
const N = defineRange(numberScalar);
const b = (n: number) => BigInt(n);

/**
 * Inverted ranges — a range that begins above where it ends — are rejected at
 * construction.
 *
 * The reason is not tidiness. An inverted range contains nothing, but
 * `isEmpty()` is FALSE for it: isEmpty() asks "did the endpoints meet, with at
 * least one side open", and an inverted range never met at all. So every guard
 * this library builds on isEmpty() — the write-side guard in
 * `RangeMap.combinedPut`, the read-side filters in `asMapOfRanges` / `span` —
 * lets it through, and a map holding only `[0.5..-0.5)` reports a span of
 * `[0.5..-0.5)` and one visible entry for a map that associates a value with
 * nothing. That is a hole punched through the empty-range invariant by the one
 * input the invariant was written to catch everything else with.
 *
 * 0.1.8 behaved the same way, so this is not a regression — but 1.0.0 is the
 * release that made "empty associates with nothing" a stated rule, so the hole
 * is closed here rather than left standing.
 */
describe("inverted ranges are rejected at construction", () => {
  const BOUNDS: Array<[BoundType, BoundType]> = [
    [BoundType.CLOSED, BoundType.OPEN],
    [BoundType.CLOSED, BoundType.CLOSED],
    [BoundType.OPEN, BoundType.OPEN],
    [BoundType.OPEN, BoundType.CLOSED],
  ];

  it("refuses lower > upper for every bound-type combination", () => {
    for (const [lo, up] of BOUNDS) {
      const r = () => new NumberRange(1, lo, 0, up);
      expect(r).toThrowError(/greater than upper endpoint/);
    }
  });

  it("refuses it on the exact (bigint) domain too", () => {
    for (const [lo, up] of BOUNDS) {
      expect(() => R.openClosed(b(10), b(9))).toThrowError(/greater than upper/);
      expect(() => new Range(b(5), lo, b(1), up, bigintScalar)).toThrowError(
        /greater than upper/
      );
    }
  });

  it("names both endpoints so the call site is findable", () => {
    expect(() => NumberRange.closedOpen(0.5, -0.5)).toThrowError(
      /lower endpoint \(0\.5\) is greater than upper endpoint \(-0\.5\)/
    );
  });

  it("carries the whole message verbatim, so the guidance cannot rot silently", () => {
    // Asserting the full string, not a fragment: a mutant that blanks any one of
    // the concatenated pieces keeps the regex above passing while quietly deleting
    // the part of the message that tells you what to do instead.
    let message = "";
    try {
      NumberRange.closedOpen(0.5, -0.5);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBe(
      'Range: lower endpoint (0.5) is greater than upper endpoint (-0.5). An inverted range ' +
        'contains nothing but is not isEmpty(), so no guard built on isEmpty() can catch it and it ' +
        'cannot be given a consistent meaning. Put the endpoints the right way round, or use an ' +
        'empty range such as [v..v) if you mean "nothing".'
    );
  });

  it("still reports the inversion when the scalar cannot render its own endpoints", () => {
    // The error path builds its message with scalar.format(). If format() throws,
    // the catch must swallow THAT and still report the inversion — otherwise the
    // check reports the wrong thing at exactly the moment it fires, which is the
    // worst possible failure for a diagnostic.
    const hostileScalar = {
      compare: numberScalar.compare,
      minusInfinity: Number.NEGATIVE_INFINITY,
      plusInfinity: Number.POSITIVE_INFINITY,
      isPlusInfinity: numberScalar.isPlusInfinity,
      isMinusInfinity: numberScalar.isMinusInfinity,
      format: (): string => {
        throw new Error("format exploded");
      },
    };
    const H = defineRange(hostileScalar);

    let message = "";
    expect(() => H.closedOpen(5, 1)).toThrowError(/greater than upper endpoint/);
    try {
      H.closedOpen(5, 1);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("greater than upper endpoint");
    expect(message).toContain("<unrenderable>");
    expect(message).not.toContain("format exploded");
  });

  it("refuses the static factories, not just the constructor", () => {
    expect(() => NumberRange.closed(5, 1)).toThrowError(/greater than upper/);
    expect(() => NumberRange.open(5, 1)).toThrowError(/greater than upper/);
    expect(() => NumberRange.openClosed(5, 1)).toThrowError(/greater than upper/);
    expect(() => NumberRange.closedOpen(5, 1)).toThrowError(/greater than upper/);
  });

  it("refuses inverted Date endpoints on the Comparable path", () => {
    const late = new Date("2026-01-02T00:00:00Z");
    const early = new Date("2026-01-01T00:00:00Z");
    expect(() => NumberRange.closedOpen(late, early)).toThrowError(/greater than upper/);
  });

  it("refuses a bounded side beyond an unbounded one", () => {
    // closed(5, -Infinity) is inverted: the upper side is the domain floor.
    expect(() => NumberRange.closed(5, Number.NEGATIVE_INFINITY)).toThrowError(
      /greater than upper/
    );
    expect(() => NumberRange.closedOpen(Number.POSITIVE_INFINITY, 3)).toThrowError(
      /greater than upper/
    );
  });

  // The boundary matters as much as the rejection. Cut order deliberately puts an
  // open LOWER bound above an open UPPER bound at the same value — that is what
  // makes `(v..v)` empty-but-valid. A validity check written on cuts instead of
  // on values would reject these four along with the genuine inversions.
  it("still allows every equal-endpoint combination", () => {
    expect(() => NumberRange.closed(3, 3)).not.toThrow();
    expect(() => NumberRange.closedOpen(3, 3)).not.toThrow();
    expect(() => NumberRange.openClosed(3, 3)).not.toThrow();
    expect(() => NumberRange.open(3, 3)).not.toThrow();

    expect(NumberRange.closed(3, 3).isEmpty()).toBeFalse();
    expect(NumberRange.closed(3, 3).contains(3)).toBeTrue();
    expect(NumberRange.closedOpen(3, 3).isEmpty()).toBeTrue();
    expect(NumberRange.open(3, 3).isEmpty()).toBeTrue();
  });

  it("still allows the unbounded family", () => {
    expect(() => NumberRange.all()).not.toThrow();
    expect(() => NumberRange.atLeast(1)).not.toThrow();
    expect(() => NumberRange.atMost(1)).not.toThrow();
    expect(() => NumberRange.downTo(1, BoundType.OPEN)).not.toThrow();
    expect(() => NumberRange.upTo(1, BoundType.CLOSED)).not.toThrow();
    expect(() => R.all()).not.toThrow();
    expect(() => R.atLeast(b(1))).not.toThrow();
  });

  it("does NOT treat an unordered endpoint as an inverted one", () => {
    // NaN is neither greater nor less. The Scalar contract says an unordered
    // comparison is a non-answer that propagates as false, not a construction
    // error — turning it into a throw would invent a verdict it does not have.
    expect(() => NumberRange.closedOpen(Number.NaN, 5)).not.toThrow();
    expect(() => NumberRange.closedOpen(5, Number.NaN)).not.toThrow();
    expect(NumberRange.closedOpen(Number.NaN, 5).contains(1)).toBeFalse();
  });

  it("cannot be smuggled into a RangeMap through put or putCoalescing", () => {
    const m = new RangeMap<string>();
    expect(() => m.put(NumberRange.closedOpen(0.5, -0.5), "x")).toThrowError(
      /greater than upper/
    );
    expect(() => m.putCoalescing(NumberRange.closed(9, 1), "y")).toThrowError(
      /greater than upper/
    );
    // Nothing landed: the map is still empty, so span() has nothing to misreport.
    expect(m.span()).toBeNull();
    expect(m.asMapOfRanges().size).toBe(0);
    expect(m.get(0)).toBeNull();
  });

  it("cannot be smuggled in by remove()", () => {
    const m = new RangeMap<string>();
    m.put(NumberRange.closedOpen(0, 10), "a");
    expect(() => m.remove(NumberRange.closed(8, 2))).toThrowError(/greater than upper/);
    // The original entry survives untouched — remove did not half-apply.
    expect(m.get(5)).toBe("a");
    expect(m.span()?.toString()).toBe("[0..10)");
  });

  it("leaves the map span honest on the exact domain", () => {
    const m = new RangeMap<string, BigIntPoint>();
    expect(() => m.put(R.closedOpen(b(100), b(0)), "bogus")).toThrowError(
      /greater than upper/
    );
    expect(m.span()).toBeNull();
  });

  it("keeps intersection and span inside the valid set", () => {
    // Derived ranges must never come back inverted, which the constructor now
    // guarantees loudly rather than by argument.
    const a = NumberRange.closedOpen(0, 5);
    const c = NumberRange.closedOpen(4, 9);
    expect(() => a.intersection(c)).not.toThrow();
    expect(() => a.span(c)).not.toThrow();
    expect(a.intersection(c)?.toString()).toBe("[4..5)");
    expect(a.span(c).toString()).toBe("[0..9)");
  });

  it("reports the rejection through the numberScalar factory as well", () => {
    expect(() => N.closedOpen(2, 1)).toThrowError(/greater than upper/);
    expect(() => N.closedOpen(1, 2)).not.toThrow();
  });
});
