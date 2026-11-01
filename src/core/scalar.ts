/**
 * A "scalar" is the library's abstraction over a number-like point domain.
 *
 * The library deliberately knows nothing about what a number IS. Every ordering
 * decision in `Range` goes through `compare`, so the same range machinery serves
 * any point domain — JS `number`, native `bigint`, a decimal, a fixed-point
 * money type, a version tuple — as long as the consumer can describe how to
 * compare it. The library never converts endpoints to another type and never
 * assumes they are doubles.
 *
 * WHY THIS EXISTS
 * ---------------
 * The previous contract was `Comparable.valueOf(): number`. JS `number` is an
 * IEEE-754 double, so beyond 2^53 consecutive integers are not representable:
 * at ~1.5e18 the spacing is 256, which means `x + 1 === x` and two distinct ids
 * can compare equal. Any domain whose ids exceed the safe-integer range
 * (snowflake ids, nanosecond epochs, 64-bit sequence numbers, large decimals)
 * silently loses precision the moment it passes through `valueOf()`.
 *
 * INFINITY IS A VALUE THE SCALAR OWNS
 * ---------------------------------
 * `minusInfinity` / `plusInfinity` are REQUIRED and explicit. There is no
 * `null`, no `undefined`, and no "absent means unbounded" convention anywhere in
 * this design, because those forms conflate things that must stay distinct:
 *
 *   - "this side is unbounded below" and "this side is unbounded above" are
 *     different facts, so the two sentinels must never be interchangeable;
 *   - "no value was supplied" is not the same as "the value is unbounded".
 *
 * Each domain picks a representation that cannot be confused with a real value in
 * that domain: `number` uses its native `±Infinity`; `bigint` has no infinity of
 * its own, so its scalar carries two explicit sentinel strings that are not
 * bigints and so can never be mistaken for one.
 *
 * Consumers are not expected to inspect those values. Ask the scalar, with a
 * direction: `isMinusInfinity(v)` / `isPlusInfinity(v)`, or the range-level
 * `isBoundedBelow()` / `isBoundedAbove()`.
 *
 * PERFORMANCE
 * -----------
 * The scalar is stored once per range and shared by reference; it is not created
 * per operation. A comparison is one indirect call with no boxing, and endpoints
 * are never converted to another type.
 */
export interface Scalar<T> {
  /**
   * Trichotomous comparison. Must return a negative number if a < b, zero if
   * a == b, positive if a > b. Must be consistent with itself across calls: the
   * range machinery relies on equality meaning `compare() === 0` when merging
   * bound types in `intersection`/`span`, so an inconsistent compare produces a
   * wrong bound type rather than throwing.
   *
   * Must also order the domain's own infinities correctly, since they are values
   * of `T` like any other: compare(minusInfinity, x) < 0 and
   * compare(plusInfinity, x) > 0 for every other x.
   */
  compare(a: T, b: T): number;

  /**
   * The domain's value for "less than everything else in the domain".
   * Required and explicit — see the note on the interface.
   */
  readonly minusInfinity: T;

  /**
   * The domain's value for "greater than everything else in the domain".
   * Required and explicit — see the note on the interface.
   */
  readonly plusInfinity: T;

  /**
   * Is `a` this domain's POSITIVE infinity?
   *
   * Directional on purpose. `isPlusInfinity(minusInfinity)` must be false. A
   * single "isInfinity" predicate is deliberately not offered: it invites code
   * that treats both ends as the same case, which is exactly the conflation this
   * design removes.
   */
  isPlusInfinity(a: T): boolean;

  /** Is `a` this domain's NEGATIVE infinity? Directional; see `isPlusInfinity`. */
  isMinusInfinity(a: T): boolean;

  /**
   * Render a value for `Range.toString()`. Defaults to `String(value)`.
   * Should render the two infinities as "-∞" and "+∞".
   */
  format?(a: T): string;

  /**
   * The least value strictly greater than `a`, for DISCRETE domains.
   *
   * Optional. When present, `Range.isAdjacentTo` can decide that [a..b] and
   * [b+1..c] touch, which is what makes consecutive-range merging meaningful
   * on integer-ish domains. On a continuous domain (real numbers) there is no
   * such value, so it is simply omitted and adjacency is never inferred.
   *
   * Should throw for the infinities, which have no successor; `isAdjacentTo`
   * treats a throw as "not adjacent" rather than propagating.
   */
  succ?(a: T): T;

  /** The greatest value strictly less than `a`. The mirror of `succ`. */
  pred?(a: T): T;
}
