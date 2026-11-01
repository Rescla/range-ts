import {
  BIGINT_MINUS_INFINITY,
  BIGINT_PLUS_INFINITY,
  BigIntPoint,
  bigintScalar,
  comparableScalar,
  numberScalar,
} from "../core/scalars";
import { defineRange } from "./range";
import { RangeMap } from "../range-map/range-map";

// BigInt(...) rather than a literal: this package compiles to ES5 for
// cjs/esm5/karma, where `1n` is a syntax error.
const B = (v: string | number): bigint => BigInt(v);

const R = defineRange(bigintScalar);

describe("Range<T> over an exact scalar", () => {
  describe("why the abstraction exists: precision", () => {
    it("keeps 2^53+1 distinct where the number path collapses it", () => {
      // 9007199254740993 is 2^53 + 1: not representable as a double.
      const exactA = B("9007199254740993");
      const exactB = B("9007199254740992");

      expect(bigintScalar.compare(exactA, exactB)).toBe(1);
      expect(bigintScalar.compare(exactB, exactA)).toBe(-1);

      // The same two values through the number path compare EQUAL. This is the
      // bug the scalar abstraction exists to avoid, asserted rather than described.
      expect(numberScalar.compare(9007199254740993, 9007199254740992)).toBe(0);
    });

    it("does not treat adjacency as equality at snowflake magnitude", () => {
      // At ~1.5e18 the double spacing is 256, so x + 1 === x as a number.
      const snowflake = 1.5e18;
      expect(snowflake + 1).toBe(snowflake);

      // With bigint, stepping is real and adjacency is decidable.
      const a = R.closed(B("1500000000000000100"), B("1500000000000000100"));
      const next = R.closed(B("1500000000000000101"), B("1500000000000000200"));
      expect(a.isAdjacentTo(next)).toBeTrue();
    });
  });

  describe("infinity is a value the scalar owns, and the ends are never conflated", () => {
    it("carries sentinels that cannot be confused with real points", () => {
      // Not bigints, so no arithmetic on domain values can ever produce them.
      expect(typeof BIGINT_PLUS_INFINITY).toBe("string");
      expect(typeof BIGINT_MINUS_INFINITY).toBe("string");
      expect(BIGINT_PLUS_INFINITY).not.toBe(BIGINT_MINUS_INFINITY);
    });

    it("answers directionally in both directions", () => {
      expect(bigintScalar.isPlusInfinity(R.positiveInfinity)).toBeTrue();
      expect(bigintScalar.isMinusInfinity(R.positiveInfinity)).toBeFalse();

      expect(bigintScalar.isMinusInfinity(R.negativeInfinity)).toBeTrue();
      expect(bigintScalar.isPlusInfinity(R.negativeInfinity)).toBeFalse();
    });

    it("never calls a finite point an infinity", () => {
      const huge = B(
        "115792089237316195423570985008687907853269984665640564039457584007913129639936"
      ); // 2^256
      expect(bigintScalar.isPlusInfinity(huge)).toBeFalse();
      expect(bigintScalar.isMinusInfinity(huge)).toBeFalse();
      // and it is not greater than +infinity
      expect(bigintScalar.compare(huge, R.positiveInfinity)).toBe(-1);
    });

    it("orders the infinities at the extremes", () => {
      expect(bigintScalar.compare(R.negativeInfinity, B(0))).toBe(-1);
      expect(bigintScalar.compare(R.positiveInfinity, B(0))).toBe(1);
      expect(bigintScalar.compare(R.negativeInfinity, R.positiveInfinity)).toBe(-1);
      expect(bigintScalar.compare(R.negativeInfinity, R.negativeInfinity)).toBe(0);
    });
  });

  describe("boundedness is asked, not inspected", () => {
    it("reports each side independently", () => {
      const bounded = R.closedOpen(B(10), B(20));
      expect(bounded.isBoundedBelow()).toBeTrue();
      expect(bounded.isBoundedAbove()).toBeTrue();

      const unboundedAbove = R.atLeast(B(10));
      expect(unboundedAbove.isBoundedBelow()).toBeTrue();
      expect(unboundedAbove.isBoundedAbove()).toBeFalse();

      const unboundedBelow = R.atMost(B(10));
      expect(unboundedBelow.isBoundedBelow()).toBeFalse();
      expect(unboundedBelow.isBoundedAbove()).toBeTrue();

      const everything = R.all();
      expect(everything.isBoundedBelow()).toBeFalse();
      expect(everything.isBoundedAbove()).toBeFalse();
    });

    it("throws rather than handing back a sentinel for an unbounded side", () => {
      expect(() => R.atLeast(B(10)).upperEndpointOrThrow()).toThrow();
      expect(() => R.atMost(B(10)).lowerEndpointOrThrow()).toThrow();
      expect(R.closedOpen(B(10), B(20)).lowerEndpointOrThrow()).toBe(B(10));
    });
  });

  describe("algebra over the exact domain", () => {
    it("contains respects bound types", () => {
      const r = R.closedOpen(B(10), B(20));
      expect(r.contains(B(10))).toBeTrue();
      expect(r.contains(B(19))).toBeTrue();
      expect(r.contains(B(20))).toBeFalse();
      expect(r.contains(B(9))).toBeFalse();
    });

    it("intersects", () => {
      const result = R.closedOpen(B(2), B(10)).intersection(R.atLeast(B(5)));
      expect(result?.toString()).toBe("[5..10)");
    });

    it("returns null for a disjoint intersection", () => {
      expect(R.closedOpen(B(2), B(4)).intersection(R.atLeast(B(9)))).toBeNull();
    });

    it("spans across an unbounded side", () => {
      expect(R.closed(B(1), B(5)).span(R.atLeast(B(12))).toString()).toBe("[1..+∞)");
      expect(R.all().toString()).toBe("(-∞..+∞)");
    });

    it("does not consider a gap adjacent", () => {
      const a = R.closed(B(1), B(5));
      expect(a.isAdjacentTo(R.closed(B(6), B(9)))).toBeTrue();
      expect(a.isAdjacentTo(R.closed(B(7), B(9)))).toBeFalse();
    });

    it("declines adjacency on a continuous domain with no successor", () => {
      const N = defineRange(numberScalar);
      // numberScalar has no succ: adjacency cannot be asserted, never guessed.
      expect(N.closed(1, 5).isAdjacentTo(N.closed(6, 9))).toBeFalse();
    });

    it("treats a throwing successor as not adjacent rather than propagating", () => {
      // succ throws at the infinities; isAdjacentTo must swallow and say false.
      expect(R.all().isAdjacentTo(R.all())).toBeFalse();
    });
  });

  describe("RangeMap keyed on the exact domain", () => {
    it("coalesces equal values across exact points", () => {
      const m = new RangeMap<string, BigIntPoint>();
      m.putCoalescing(R.closedOpen(B(10), B(20)), "a");
      m.putCoalescing(R.closedOpen(B(20), B(30)), "a");

      expect(m.get(B(15))).toBe("a");
      expect(m.get(B(25))).toBe("a");
      expect(m.asMapOfRanges().size).toBe(1);
      const [merged] = [...m.asMapOfRanges().keys()];
      expect(merged.toString()).toBe("[10..30)");
    });

    it("keeps distinct values distinct and sorts without numeric subtraction", () => {
      const m = new RangeMap<string, BigIntPoint>();
      m.put(R.closedOpen(B(20), B(30)), "b");
      m.put(R.closedOpen(B(10), B(20)), "a");

      const keys = [...m.asMapOfRanges().keys()].map((k) => k.toString());
      expect(keys).toEqual(["[10..20)", "[20..30)"]);
      expect(m.get(B(25))).toBe("b");
    });

    it("spans the map including an unbounded entry", () => {
      const m = new RangeMap<string, BigIntPoint>();
      m.put(R.closedOpen(B(10), B(20)), "a");
      m.put(R.atLeast(B(50)), "b");
      expect(m.span()?.toString()).toBe("[10..+∞)");
    });
  });

  describe("number path keeps the same directional contract", () => {
    const N = defineRange(numberScalar);

    it("checks its native infinities directionally", () => {
      expect(numberScalar.isPlusInfinity(Number.POSITIVE_INFINITY)).toBeTrue();
      expect(numberScalar.isMinusInfinity(Number.POSITIVE_INFINITY)).toBeFalse();
      expect(numberScalar.isMinusInfinity(Number.NEGATIVE_INFINITY)).toBeTrue();
      expect(numberScalar.isPlusInfinity(Number.NEGATIVE_INFINITY)).toBeFalse();
      expect(numberScalar.isPlusInfinity(1.5e18)).toBeFalse();
      expect(numberScalar.isMinusInfinity(0)).toBeFalse();
    });

    it("reports boundedness on the number path", () => {
      expect(N.atLeast(1).isBoundedBelow()).toBeTrue();
      expect(N.atLeast(1).isBoundedAbove()).toBeFalse();
      expect(N.atMost(1).isBoundedBelow()).toBeFalse();
      expect(N.atMost(1).isBoundedAbove()).toBeTrue();
      expect(N.all().isBoundedBelow()).toBeFalse();
      expect(N.all().isBoundedAbove()).toBeFalse();
    });

    it("throws on an unbounded side instead of returning Infinity", () => {
      expect(() => N.atMost(5).lowerEndpointOrThrow()).toThrow();
      expect(() => N.atLeast(5).upperEndpointOrThrow()).toThrow();
      expect(N.closed(2, 3).upperEndpointOrThrow()).toBe(3);
    });

    it("comparableScalar answers directionally for Date and number alike", () => {
      expect(comparableScalar.isPlusInfinity(Number.POSITIVE_INFINITY)).toBeTrue();
      expect(comparableScalar.isMinusInfinity(Number.POSITIVE_INFINITY)).toBeFalse();
      expect(comparableScalar.isMinusInfinity(Number.NEGATIVE_INFINITY)).toBeTrue();
      expect(comparableScalar.isPlusInfinity(new Date(0))).toBeFalse();
      expect(comparableScalar.isMinusInfinity(new Date(0))).toBeFalse();
    });
  });

  describe("successor / predecessor on the exact domain", () => {
    it("steps by one, exactly", () => {
      expect(bigintScalar.succ!(B(5))).toBe(B(6));
      expect(bigintScalar.pred!(B(5))).toBe(B(4));
      expect(bigintScalar.pred!(B("9007199254740993"))).toBe(B("9007199254740992"));
    });

    it("throws at the infinities rather than wrapping into the domain", () => {
      expect(() => bigintScalar.succ!(R.positiveInfinity)).toThrow();
      expect(() => bigintScalar.succ!(R.negativeInfinity)).toThrow();
      expect(() => bigintScalar.pred!(R.positiveInfinity)).toThrow();
      expect(() => bigintScalar.pred!(R.negativeInfinity)).toThrow();
    });
  });

  describe("bound merging on equal endpoints", () => {
    it("span keeps CLOSED if either side is closed", () => {
      expect(R.closed(B(1), B(5)).span(R.openClosed(B(1), B(9))).toString()).toBe("[1..9]");
      // (1..5) is contained in [1..9], so the minimal enclosing range is [1..9]:
      // the lower merge picks CLOSED, and the upper comes from the wider side.
      expect(R.open(B(1), B(5)).span(R.closed(B(1), B(9))).toString()).toBe("[1..9]");
    });

    it("span stays OPEN only when both sides are open", () => {
      expect(R.open(B(1), B(5)).span(R.open(B(1), B(9))).toString()).toBe("(1..9)");
    });

    it("intersection takes OPEN if either side is open", () => {
      expect(R.closed(B(1), B(5)).intersection(R.openClosed(B(1), B(9)))!.toString()).toBe("(1..5]");
      expect(R.closed(B(1), B(9)).intersection(R.closed(B(1), B(5)))!.toString()).toBe("[1..5]");
    });
  });

  describe("a consumer-defined scalar needs nothing from the library", () => {
    it("drives the whole machinery over a decimal-string domain", () => {
      // A domain that is neither number nor bigint: money held as a decimal
      // string. Nothing in range-ts knows about it, yet the full algebra works.
      type Cents = string;
      const asScaled = (s: string): bigint => BigInt(s.replace(".", "").padStart(3, "0"));

      const moneyScalar = {
        compare: (a: Cents, b: Cents) => {
          const av = asScaled(a);
          const bv = asScaled(b);
          return av < bv ? -1 : av > bv ? 1 : 0;
        },
        minusInfinity: "<<MIN>>" as Cents,
        plusInfinity: ">>MAX<<" as Cents,
        isPlusInfinity: (a: Cents) => a === ">>MAX<<",
        isMinusInfinity: (a: Cents) => a === "<<MIN>>",
        format: (a: Cents) => `€${a}`,
      };

      const M = defineRange(moneyScalar);
      const price = M.closedOpen("10.00", "25.50");

      expect(price.contains("10.00")).toBeTrue();
      expect(price.contains("25.49")).toBeTrue();
      expect(price.contains("25.50")).toBeFalse();
      expect(price.toString()).toBe("[€10.00..€25.50)");
      expect(M.all().toString()).toBe("(€<<MIN>>..€>>MAX<<)");
      expect(M.atLeast("5.00").isBoundedAbove()).toBeFalse();
    });
  });
});
