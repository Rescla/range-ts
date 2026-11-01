import {
  BIGINT_MINUS_INFINITY,
  BIGINT_PLUS_INFINITY,
  bigintScalar,
  comparableScalar,
  numberScalar,
} from "./scalars";

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
      expect(bigintScalar.compare(a, b)).withContext(`${String(a)} vs ${String(b)}`).toBe(want);
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
