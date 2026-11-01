import { Comparable } from "./comparable";
import { Scalar } from "./scalar";

/**
 * The default scalar for `Comparable` endpoints: ordering is decided by
 * `valueOf()`, exactly as the library always behaved.
 *
 * This is the JS-number path. It is heterogeneous on purpose — a `Date`
 * endpoint and a raw `number` compare fine because both reduce to a double.
 * It uses the domain's NATIVE `±Infinity`, so the historical `(-∞..+∞)`
 * rendering and comparison behaviour are preserved unchanged.
 *
 * PRECISION WARNING: `valueOf()` returns a JS `number`, so this scalar inherits
 * the double's 2^53 limit. Beyond that, consecutive values are not
 * distinguishable and `x + 1 === x`. If your ids are that large, do not stretch
 * this scalar — define your own `Scalar<T>` that compares in your own
 * representation. See `scalar-range.spec.ts` for a worked consumer-side example,
 * and `bigintScalar` for a shipped one.
 */
export const comparableScalar: Scalar<Comparable> = {
  compare(a: Comparable, b: Comparable): number {
    const av = a == null ? NaN : a.valueOf();
    const bv = b == null ? NaN : b.valueOf();
    if (av < bv) return -1;
    if (av > bv) return 1;
    if (av === bv) return 0;
    // NaN involved: fall back to identity so equality stays reflexive.
    return a === b ? 0 : NaN;
  },

  minusInfinity: Number.NEGATIVE_INFINITY as unknown as Comparable,
  plusInfinity: Number.POSITIVE_INFINITY as unknown as Comparable,

  // Compared against the primitive, so a boxed Number wrapper of Infinity also
  // matches — which is what `==` on the previous implementation's sentinels did.
  isPlusInfinity(a: Comparable): boolean {
    return a != null && a.valueOf() === Number.POSITIVE_INFINITY;
  },

  isMinusInfinity(a: Comparable): boolean {
    return a != null && a.valueOf() === Number.NEGATIVE_INFINITY;
  },

  format(a: Comparable): string {
    const v = a == null ? NaN : a.valueOf();
    if (v === Number.POSITIVE_INFINITY) return "+∞";
    if (v === Number.NEGATIVE_INFINITY) return "-∞";
    // Preserve the long-standing behaviour of printing Date-like endpoints as
    // ISO strings rather than as epoch millis.
    const maybeDate = a as unknown as { toISOString?: () => string };
    if (maybeDate && typeof maybeDate.toISOString === "function") {
      return maybeDate.toISOString();
    }
    return String(v);
  },
};

/** Scalar for plain JS `number` endpoints. Same precision limits as above. */
export const numberScalar: Scalar<number> = {
  compare(a: number, b: number): number {
    if (a < b) return -1;
    if (a > b) return 1;
    if (a === b) return 0;
    return NaN;
  },
  minusInfinity: Number.NEGATIVE_INFINITY,
  plusInfinity: Number.POSITIVE_INFINITY,
  isPlusInfinity(a: number): boolean {
    return a === Number.POSITIVE_INFINITY;
  },
  isMinusInfinity(a: number): boolean {
    return a === Number.NEGATIVE_INFINITY;
  },
  format(a: number): string {
    if (a === Number.POSITIVE_INFINITY) return "+∞";
    if (a === Number.NEGATIVE_INFINITY) return "-∞";
    return String(a);
  },
};

/**
 * The sentinel that stands for positive infinity in the `bigint` domain.
 *
 * `bigint` has no infinity, and a sentinel bigint (say `2n ** 256n`) would be a
 * lie: it is a value that could in principle be exceeded, and worse, it would sit
 * inside the domain and be indistinguishable from a legitimate point. So the
 * scalar carries a value that is NOT a bigint. It cannot collide with a real
 * point, cannot be produced by arithmetic on points, and is distinguishable from
 * its negative counterpart by identity.
 */
export const BIGINT_PLUS_INFINITY = "+INF" as const;

/** The sentinel that stands for negative infinity in the `bigint` domain. */
export const BIGINT_MINUS_INFINITY = "-INF" as const;

/**
 * A point in the exact-integer domain: a `bigint`, or one of the two explicit
 * infinities.
 *
 * The union is deliberate and visible in the type. Consumers who only ever pass
 * real points and ask range-level questions (`contains`, `isBoundedBelow`,
 * `span`) never need to narrow. Those who construct unbounded ranges directly
 * name the sentinel they mean, so positive and negative are never confused.
 */
export type BigIntPoint = bigint | typeof BIGINT_PLUS_INFINITY | typeof BIGINT_MINUS_INFINITY;

/**
 * Scalar for native JS `bigint` points.
 *
 * This is the reason the abstraction exists. `bigint` is exact at any magnitude,
 * so unlike the `number` path it does NOT collapse at 2^53:
 *
 *   numberScalar.compare(9007199254740993, 9007199254740992)  // 0  <- lost
 *   bigintScalar.compare(9007199254740993n, 9007199254740992n) // 1  <- exact
 *
 * It is also DISCRETE, so `succ`/`pred` are defined and `Range.isAdjacentTo`
 * can tell that [a..b] and [b+1..c] touch — the property a snowflake- or
 * sequence-id consumer needs and the `number` path cannot give, because at that
 * magnitude `x + 1 === x`.
 */
export const bigintScalar: Scalar<BigIntPoint> = {
  compare(a: BigIntPoint, b: BigIntPoint): number {
    if (a === BIGINT_MINUS_INFINITY) return b === BIGINT_MINUS_INFINITY ? 0 : -1;
    if (a === BIGINT_PLUS_INFINITY) return b === BIGINT_PLUS_INFINITY ? 0 : 1;
    if (b === BIGINT_MINUS_INFINITY) return 1;
    if (b === BIGINT_PLUS_INFINITY) return -1;
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  },

  minusInfinity: BIGINT_MINUS_INFINITY,
  plusInfinity: BIGINT_PLUS_INFINITY,

  isPlusInfinity(a: BigIntPoint): boolean {
    return a === BIGINT_PLUS_INFINITY;
  },

  isMinusInfinity(a: BigIntPoint): boolean {
    return a === BIGINT_MINUS_INFINITY;
  },

  format(a: BigIntPoint): string {
    if (a === BIGINT_PLUS_INFINITY) return "+∞";
    if (a === BIGINT_MINUS_INFINITY) return "-∞";
    return a.toString();
  },

  succ(a: BigIntPoint): BigIntPoint {
    if (a === BIGINT_PLUS_INFINITY) {
      throw new Error("plusInfinity has no successor");
    }
    if (a === BIGINT_MINUS_INFINITY) {
      throw new Error("minusInfinity has no successor within the finite domain");
    }
    // Call form, not the `1n` literal. Our own build targets es2020, where both
    // are valid, but a bigint LITERAL is ES2020 *syntax*: a consumer
    // transpiling this ESM to an older target hits a parse error on `1n` where
    // `BigInt(1)` parses fine. (The `BigInt` runtime is required either way —
    // this only avoids failing at parse time, it is not a polyfill.)
    return a + BigInt(1);
  },

  pred(a: BigIntPoint): BigIntPoint {
    if (a === BIGINT_MINUS_INFINITY) {
      throw new Error("minusInfinity has no predecessor");
    }
    if (a === BIGINT_PLUS_INFINITY) {
      throw new Error("plusInfinity has no predecessor within the finite domain");
    }
    // Call form for the same reason as in `succ`.
    return a - BigInt(1);
  },
};
