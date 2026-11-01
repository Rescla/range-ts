import { BoundType } from "../core/bound-type";
import { Comparable } from "../core/comparable";
import { comparableScalar } from "../core/scalars";
import { NumberRange } from "../number-range/number-range";
import { RangeMap } from "../range-map/range-map";
import { Range } from "./range";

/**
 * Range immutability.
 *
 * Every guarantee this class makes about itself is made inside its constructor:
 * the bound types are valid, the endpoints are not inverted, the scalar is the
 * one that ordered them. A field written after construction invalidates all of
 * it at once, and `readonly` does not stop that — it erases.
 *
 * The concrete failure this closes, from the audit of the pre-fix build:
 *
 *   const r = NumberRange.closed(1, 10);
 *   r.lowerEndpoint = 99;            // [99..10], isEmpty() === false
 *
 * which is exactly the inverted-but-not-empty state the constructor's own
 * comment says cannot be given a consistent meaning. It also reached the map:
 * a Range is stored by reference and handed back out by `getEntry` and
 * `asMapOfRanges`, so a consumer mutating what it read corrupted the
 * disjointness and sort invariants `span` and `subRangeMap` depend on.
 *
 * Assertions are written as POST-CONDITIONS (the value did not change) rather
 * than only as "the write throws", because a frozen-property write throws in
 * strict mode and is silently dropped in sloppy mode. Both are safe; only the
 * post-condition holds in either.
 */
describe("a Range is immutable after construction", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(NumberRange.closed(1, 10))).toBe(true);
    expect(
      Object.isFrozen(new Range(1, BoundType.CLOSED, 2, BoundType.OPEN, comparableScalar))
    ).toBe(true);
    expect(Object.isFrozen(NumberRange.all())).toBe(true);
  });

  it("accepts no write to any field, loudly or silently", () => {
    const r = NumberRange.closed(1, 10);
    const attempts: Array<[string, () => void]> = [
      ["lowerEndpoint", () => ((r as any).lowerEndpoint = 99)],
      ["upperEndpoint", () => ((r as any).upperEndpoint = -99)],
      ["lowerBoundType", () => ((r as any).lowerBoundType = BoundType.OPEN)],
      ["upperBoundType", () => ((r as any).upperBoundType = BoundType.OPEN)],
      ["scalar", () => ((r as any).scalar = null)],
    ];

    for (const [field, write] of attempts) {
      try {
        write();
      } catch {
        /* strict mode throws; sloppy mode drops the write. Both are fine. */
      }
      expect(String(r)).withContext(field).toBe("[1..10]");
    }
  });

  it("cannot be mutated through Object.assign or defineProperty", () => {
    const r = NumberRange.closed(1, 10);
    try {
      Object.assign(r as any, { lowerEndpoint: -999 });
    } catch {
      /* as above */
    }
    expect(String(r)).toBe("[1..10]");

    try {
      Object.defineProperty(r as any, "lowerEndpoint", { value: -1 });
    } catch {
      /* as above */
    }
    expect(String(r)).toBe("[1..10]");
  });

  it("cannot have its prototype patched to rewrite membership testing", () => {
    // `Range.prototype.contains = () => true` from any module would otherwise
    // rewrite membership for every range in the process.
    expect(Object.isFrozen(Range.prototype)).toBe(true);
    try {
      (Range.prototype as any).contains = () => true;
    } catch {
      /* as above */
    }
    expect(NumberRange.closed(1, 10).contains(999)).toBe(false);
  });

  it("cannot be inverted by mutating a range read back out of a RangeMap", () => {
    // The map hands out internal range objects via getEntry. That is safe
    // precisely because those objects are frozen.
    const m = new RangeMap<string>();
    m.put(NumberRange.closedOpen(0, 10), "a");
    m.put(NumberRange.closedOpen(20, 30), "b");

    const entry = m.getEntry(5);
    expect(entry).not.toBeNull();
    const handedOut = entry![0] as any;

    try {
      handedOut.lowerEndpoint = -1000;
    } catch {
      /* as above */
    }

    expect(String(m.span())).toBe("[0..30)");
    expect(m.get(5)).toBe("a");
    expect(m.get(25)).toBe("b");
    expect([...m.asMapOfRanges()].map(([k, v]) => `${k}->${v}`).join(", ")).toBe(
      "[0..10)->a, [20..30)->b"
    );
  });
});

describe("a Range subclass does not reopen the fields", () => {
  it("NumberRange inherits immutability rather than reassigning the base fields", () => {
    // A `public` parameter property on the subclass emits an assignment after
    // super() returns, onto an already-frozen instance. NumberRange is written
    // without parameter properties for exactly that reason; this pins it.
    const nr = new NumberRange(1, BoundType.CLOSED, 5, BoundType.CLOSED);
    expect(Object.isFrozen(nr)).toBe(true);
    expect(() => {
      (nr as any).lowerEndpoint = 0;
    }).toThrow();
  });

  it("a subclass that adds its own own-fields after super() is rejected by the freeze", () => {
    // Documented consequence: a subclass may add PROTOTYPE members but must
    // not assign instance fields after super(). Pinning the consequence so it
    // is a known constraint rather than a surprise at a consumer's build time.
    class WithOwnField extends Range<Comparable> {
      constructor(lo: number, hi: number) {
        super(lo, BoundType.CLOSED, hi, BoundType.CLOSED, comparableScalar);
        try {
          (this as any).extra = 1;
        } catch {
          /* strict throws, sloppy drops */
        }
      }
    }
    const w = new WithOwnField(1, 2);
    expect((w as any).extra).toBeUndefined();
  });
});
