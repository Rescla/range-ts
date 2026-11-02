import {
  BIGINT_MINUS_INFINITY,
  BIGINT_PLUS_INFINITY,
  bigintScalar,
  comparableScalar,
  numberScalar,
} from "./scalars";
import { NumberRange } from "../number-range/number-range";
import { defineRange } from "../range/range";

/**
 * Unit-level coverage of the three shipped scalars. The range-level specs exercise
 * these indirectly; these tests pin the primitives themselves, including the
 * null/NaN edges that only matter because a range can hand a scalar a value it
 * did not construct.
 */
describe("comparableScalar", () => {
  it("orders by valueOf across mixed types", () => {
    expect(comparableScalar.compare(1, 2)).toBe(-1);
    expect(comparableScalar.compare(2, 1)).toBe(1);
    expect(comparableScalar.compare(2, 2)).toBe(0);
    expect(comparableScalar.compare(new Date(1000), new Date(2000))).toBe(-1);
    expect(comparableScalar.compare(new Date(2000), 1000)).toBe(1);
  });

  it("treats null and undefined as unordered against a real value", () => {
    expect(comparableScalar.compare(null as any, 1)).toBeNaN();
    expect(comparableScalar.compare(1, null as any)).toBeNaN();
    expect(comparableScalar.compare(undefined as any, 1)).toBeNaN();
    expect(comparableScalar.compare(1, undefined as any)).toBeNaN();
  });

  it("keeps equality reflexive for null and undefined against themselves", () => {
    expect(comparableScalar.compare(null as any, null as any)).toBe(0);
    expect(comparableScalar.compare(undefined as any, undefined as any)).toBe(0);
  });

  it("never reports NaN as equal to anything, including itself", () => {
    // Guards the identity fallback: NaN === NaN is false, so the only way this
    // returns 0 is if the equality branch were widened to cover it.
    expect(comparableScalar.compare(NaN, NaN)).toBeNaN();
    expect(comparableScalar.compare(NaN, 0)).toBeNaN();
    expect(comparableScalar.compare(0, NaN)).toBeNaN();
  });

  it("recognises both infinities and nothing else", () => {
    expect(comparableScalar.isPlusInfinity(Infinity)).toBe(true);
    expect(comparableScalar.isMinusInfinity(-Infinity)).toBe(true);
    expect(comparableScalar.isPlusInfinity(-Infinity)).toBe(false);
    expect(comparableScalar.isMinusInfinity(Infinity)).toBe(false);
    expect(comparableScalar.isPlusInfinity(1e308)).toBe(false);
    expect(comparableScalar.isMinusInfinity(-1e308)).toBe(false);
  });

  it("does not treat null or undefined as an infinity", () => {
    // A missing bound is not an infinite bound; see the null/undefined policy.
    expect(comparableScalar.isPlusInfinity(null as any)).toBe(false);
    expect(comparableScalar.isPlusInfinity(undefined as any)).toBe(false);
    expect(comparableScalar.isMinusInfinity(null as any)).toBe(false);
    expect(comparableScalar.isMinusInfinity(undefined as any)).toBe(false);
  });

  it("formats numbers, infinities, dates and null distinctly", () => {
    expect(comparableScalar.format!(7)).toBe("7");
    expect(comparableScalar.format!(Infinity)).toBe("+∞");
    expect(comparableScalar.format!(-Infinity)).toBe("-∞");
    expect(comparableScalar.format!(new Date("2020-01-02T03:04:05.000Z"))).toBe(
      "2020-01-02T03:04:05.000Z"
    );
    expect(comparableScalar.format!(null as any)).toBe("NaN");
  });
});

describe("numberScalar", () => {
  it("compares in all three directions and reports NaN as unordered", () => {
    expect(numberScalar.compare(1, 2)).toBe(-1);
    expect(numberScalar.compare(2, 1)).toBe(1);
    expect(numberScalar.compare(2, 2)).toBe(0);
    expect(numberScalar.compare(NaN, 1)).toBeNaN();
    expect(numberScalar.compare(1, NaN)).toBeNaN();
    expect(numberScalar.compare(NaN, NaN)).toBeNaN();
  });

  it("checks infinities directionally", () => {
    expect(numberScalar.isPlusInfinity(Infinity)).toBe(true);
    expect(numberScalar.isPlusInfinity(-Infinity)).toBe(false);
    expect(numberScalar.isMinusInfinity(-Infinity)).toBe(true);
    expect(numberScalar.isMinusInfinity(Infinity)).toBe(false);
  });

  it("formats finite values and both infinities", () => {
    expect(numberScalar.format!(0)).toBe("0");
    expect(numberScalar.format!(-12.5)).toBe("-12.5");
    expect(numberScalar.format!(Infinity)).toBe("+∞");
    expect(numberScalar.format!(-Infinity)).toBe("-∞");
  });
});

describe("bigintScalar", () => {
  it("orders finite points exactly", () => {
    expect(bigintScalar.compare(BigInt(1), BigInt(2))).toBe(-1);
    expect(bigintScalar.compare(BigInt(2), BigInt(1))).toBe(1);
    expect(bigintScalar.compare(BigInt(2), BigInt(2))).toBe(0);
  });

  it("places the sentinels at the extremes regardless of which side they arrive on", () => {
    const cases: Array<[any, any, number]> = [
      [BIGINT_MINUS_INFINITY, BIGINT_MINUS_INFINITY, 0],
      [BIGINT_PLUS_INFINITY, BIGINT_PLUS_INFINITY, 0],
      [BIGINT_MINUS_INFINITY, BIGINT_PLUS_INFINITY, -1],
      [BIGINT_PLUS_INFINITY, BIGINT_MINUS_INFINITY, 1],
      [BIGINT_MINUS_INFINITY, BigInt(0), -1],
      [BigInt(0), BIGINT_MINUS_INFINITY, 1],
      [BIGINT_PLUS_INFINITY, BigInt(0), 1],
      [BigInt(0), BIGINT_PLUS_INFINITY, -1],
      [BIGINT_MINUS_INFINITY, BigInt("99999999999999999999"), -1],
      [BIGINT_PLUS_INFINITY, BigInt("-99999999999999999999"), 1],
    ];
    for (const [a, b, want] of cases) {
      expect(bigintScalar.compare(a, b))
        .withContext(`${String(a)} vs ${String(b)}`)
        .toBe(want);
    }
  });

  it("checks infinities directionally", () => {
    expect(bigintScalar.isPlusInfinity(BIGINT_PLUS_INFINITY)).toBe(true);
    expect(bigintScalar.isPlusInfinity(BIGINT_MINUS_INFINITY)).toBe(false);
    expect(bigintScalar.isMinusInfinity(BIGINT_MINUS_INFINITY)).toBe(true);
    expect(bigintScalar.isMinusInfinity(BIGINT_PLUS_INFINITY)).toBe(false);
    expect(bigintScalar.isPlusInfinity(BigInt(0))).toBe(false);
    expect(bigintScalar.isMinusInfinity(BigInt(0))).toBe(false);
  });

  it("formats points and infinities", () => {
    expect(bigintScalar.format!(BigInt(42))).toBe("42");
    expect(bigintScalar.format!(BIGINT_PLUS_INFINITY)).toBe("+∞");
    expect(bigintScalar.format!(BIGINT_MINUS_INFINITY)).toBe("-∞");
  });

  it("steps finite points by one", () => {
    expect(bigintScalar.succ!(BigInt(5))).toBe(BigInt(6));
    expect(bigintScalar.pred!(BigInt(5))).toBe(BigInt(4));
    expect(bigintScalar.succ!(BigInt(-1))).toBe(BigInt(0));
  });

  it("refuses to step off either infinity, in both directions", () => {
    expect(() => bigintScalar.succ!(BIGINT_PLUS_INFINITY)).toThrowError(
      /plusInfinity has no successor/
    );
    expect(() => bigintScalar.succ!(BIGINT_MINUS_INFINITY)).toThrowError(
      /minusInfinity has no successor within the finite domain/
    );
    expect(() => bigintScalar.pred!(BIGINT_MINUS_INFINITY)).toThrowError(
      /minusInfinity has no predecessor/
    );
    expect(() => bigintScalar.pred!(BIGINT_PLUS_INFINITY)).toThrowError(
      /plusInfinity has no predecessor within the finite domain/
    );
  });
});

/**
 * `bigintScalar` shipped without the operand gate that `comparableScalar` and
 * `numberScalar` both have. Its `compare` fell through `<`/`>` to a bare
 * `return 0`, and a coercion that lands on NaN makes BOTH relational tests
 * false — so it reported `compare(4n, "x") === 0`. A bigint range therefore
 * `contains("x")`, and the cross-domain guard in `Range` (which fires on an
 * UNORDERED result) could never fire, because this comparator never produced
 * one. Pinned here so the fall-through cannot come back.
 */
describe("bigintScalar does not report garbage as equal", () => {
  it("returns NaN for a string operand instead of 0", () => {
    expect(bigintScalar.compare(4n, "x" as any)).toBeNaN();
    expect(bigintScalar.compare("x" as any, 4n)).toBeNaN();
  });

  it("returns NaN for null and undefined rather than ordering them", () => {
    expect(bigintScalar.compare(4n, null as any)).toBeNaN();
    expect(bigintScalar.compare(undefined as any, 4n)).toBeNaN();
  });

  it("returns NaN for NaN, which is unordered rather than equal to a point", () => {
    expect(bigintScalar.compare(4n, NaN as any)).toBeNaN();
    expect(bigintScalar.compare(NaN as any, 4n)).toBeNaN();
    expect(bigintScalar.compare(NaN as any, NaN as any)).toBeNaN();
  });

  it("still reports numeric equality across bigint and number: 4n == 4", () => {
    // This is the case a naive `a === b ? 0 : NaN` tail would have broken:
    // `4n === 4` is false while `4n == 4` is true, and JS defines that
    // cross-type ordering, so it must still read as equal.
    expect(bigintScalar.compare(4n, 4 as any)).toBe(0);
    expect(bigintScalar.compare(4 as any, 4n)).toBe(0);
  });

  it("still orders bigint against number past 2^53 exactly", () => {
    expect(bigintScalar.compare(9007199254740993n, 9007199254740992 as any)).toBe(1);
    expect(bigintScalar.compare(9007199254740992 as any, 9007199254740993n)).toBe(-1);
  });

  it("keeps the sentinels ordered ahead of the operand gate", () => {
    expect(bigintScalar.compare(BIGINT_PLUS_INFINITY, "x" as any)).toBe(1);
    expect(bigintScalar.compare(BIGINT_MINUS_INFINITY, 1n)).toBe(-1);
    expect(bigintScalar.compare(BIGINT_PLUS_INFINITY, BIGINT_PLUS_INFINITY)).toBe(0);
  });

  it("a bigint range does not contain a non-numeric key", () => {
    const R = defineRange(bigintScalar);
    const r = R.closed(1n, 10n);
    expect(r.contains("x" as any)).toBe(false);
    expect(r.contains(NaN as any)).toBe(false);
    expect(r.contains(5n)).toBe(true);
  });
});

/**
 * The `bigint` sentinels are exported constants whose literal value is public
 * API — a consumer may serialize them, store them, or compare against them — and
 * nothing else in the suite asserted the string itself, so a silent change would
 * have passed. Pinned here.
 */
describe("the bigint infinity sentinels are pinned to their published values", () => {
  it("are the exact strings the package publishes", () => {
    expect(BIGINT_PLUS_INFINITY).toBe("+INF");
    expect(BIGINT_MINUS_INFINITY).toBe("-INF");
  });

  it("are strings, so they cannot collide with a real point in the domain", () => {
    expect(typeof BIGINT_PLUS_INFINITY).toBe("string");
    expect(typeof BIGINT_MINUS_INFINITY).toBe("string");
    expect(BIGINT_PLUS_INFINITY).not.toBe(BIGINT_MINUS_INFINITY);
  });

  it("stay directional: neither end reads as the other", () => {
    expect(bigintScalar.isPlusInfinity(BIGINT_MINUS_INFINITY)).toBe(false);
    expect(bigintScalar.isMinusInfinity(BIGINT_PLUS_INFINITY)).toBe(false);
    expect(bigintScalar.isPlusInfinity(BIGINT_PLUS_INFINITY)).toBe(true);
    expect(bigintScalar.isMinusInfinity(BIGINT_MINUS_INFINITY)).toBe(true);
  });

  it("render as the infinities they stand for, not as their own spelling", () => {
    expect(bigintScalar.format!(BIGINT_PLUS_INFINITY)).toBe("+∞");
    expect(bigintScalar.format!(BIGINT_MINUS_INFINITY)).toBe("-∞");
  });
});

/**
 * The numeric-primitive gate in `comparableScalar.compare`.
 *
 * Before the gate, `<`/`>` coerced — and coerced DIFFERENTLY by type pair. Two
 * strings compared lexicographically, a number against a string compared
 * numerically. So the comparator ordered the same two values differently
 * depending on the runtime type of the argument. That is not a rounding
 * problem, it is a broken trichotomy: `intersection`/`span` merge bound types
 * on `compare() === 0`, and every sorted structure downstream assumes the
 * comparator is consistent. Measured before the fix:
 *
 *   compare("9", "10") =  1   compare(9, "10") = -1
 *
 * These tests pin the two properties that matter, in both directions: strings
 * never produce an ordering, and bigint DOES still produce one (JS defines the
 * cross-type bigint/number ordering exactly, so gating it off would break
 * legitimate mixed-domain use this scalar has always served).
 */
describe("comparableScalar does not guess at non-numeric orderings", () => {
  it("never orders two strings lexicographically", () => {
    expect(comparableScalar.compare("9" as any, "10" as any)).toBeNaN();
    expect(comparableScalar.compare("10" as any, "9" as any)).toBeNaN();
  });

  it("is not type-dependent for the same numeric pair", () => {
    // The exact disagreement the gate removes: all three spellings below must
    // agree, and they agreed by being WRONG before.
    expect(comparableScalar.compare("9" as any, "10" as any)).toBeNaN();
    expect(comparableScalar.compare(9, "10" as any)).toBeNaN();
    expect(comparableScalar.compare("9" as any, 10)).toBeNaN();
  });

  it("still orders bigint against number, including past 2^53", () => {
    expect(comparableScalar.compare(0, 30n as any)).toBe(-1);
    expect(comparableScalar.compare(30n as any, 0)).toBe(1);
    expect(comparableScalar.compare(9007199254740993n as any, 9007199254740992)).toBe(1);
  });

  it("rejects an object whose valueOf returns a string", () => {
    const strValued = { valueOf: () => "5" } as any;
    expect(comparableScalar.compare(strValued, 5)).toBeNaN();
  });

  it("rejects booleans, which are not a point domain", () => {
    expect(comparableScalar.compare(true as any, false as any)).toBeNaN();
  });

  it("keeps the documented NaN contract for genuinely unordered values", () => {
    expect(comparableScalar.compare(NaN, NaN)).toBeNaN();
    expect(comparableScalar.compare(NaN, 1)).toBeNaN();
    expect(comparableScalar.compare(1, NaN)).toBeNaN();
  });

  it("leaves 10 vs 10n unordered rather than claiming cross-type equality", () => {
    // `10 === 10n` is false in JS while `10 == 10n` is true. This comparator
    // does not assert cross-type numeric equality, and the cross-scalar guard
    // depends on that. Pinned so that changing it is a deliberate decision
    // with its own reasoning, not a side effect of touching this function.
    expect(comparableScalar.compare(10, 10n as any)).toBeNaN();
  });
});

describe("the shipped scalars are immutable singletons", () => {
  it("are frozen", () => {
    expect(Object.isFrozen(comparableScalar)).toBe(true);
    expect(Object.isFrozen(numberScalar)).toBe(true);
    expect(Object.isFrozen(bigintScalar)).toBe(true);
  });

  it("cannot have compare replaced to invert ordering process-wide", () => {
    // The hazard: every Range reads `this.scalar.compare` on every operation,
    // and these are shared module singletons, so one assignment anywhere
    // rewrites ordering for the whole app — invisibly to the type system and
    // to the logs. Asserted by post-condition rather than by the throw, so it
    // holds in strict mode (throws) and in sloppy mode (silently dropped).
    const original = comparableScalar.compare;
    try {
      (comparableScalar as any).compare = () => 0;
    } catch {
      /* strict mode throws; sloppy mode drops the write. Both are fine. */
    }
    expect(comparableScalar.compare).toBe(original);
    expect(comparableScalar.compare(1, 2)).toBe(-1);
    expect(NumberRange.all().isEmpty()).toBe(false);
  });
});
