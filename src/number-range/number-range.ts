import { BoundType } from "../core/bound-type";
import { Comparable } from "../core/comparable";
import { comparableScalar } from "../core/scalars";
import { Range } from "../range/range";

/**
 * A range over `Comparable` endpoints — the historical, JS-number-backed entry
 * point. Ordering is decided by `valueOf()`, so `Date` and plain `number`
 * endpoints mix freely and no conversion is ever performed on them.
 *
 * This is now a thin instantiation of the generic `Range<T>` with
 * `comparableScalar`; the range algebra lives in one place. The public shape is
 * unchanged: the same statics, the same return types, the same `toString()`
 * output.
 *
 * PRECISION: `valueOf()` yields a JS `number`, so this class inherits the
 * double's 2^53 limit. If your ids exceed `Number.MAX_SAFE_INTEGER`, do not
 * stretch this class — build a `Range<T>` over a scalar that compares in your
 * own representation (`defineRange(bigintScalar)`, or your own `Scalar<T>`).
 *
 * Based off of https://guava.dev/releases/19.0/api/docs/com/google/common/collect/Range.html
 */
export class NumberRange extends Range<Comparable> {
  constructor(
    public lowerEndpoint: Comparable,
    public lowerBoundType: BoundType,
    public upperEndpoint: Comparable,
    public upperBoundType: BoundType
  ) {
    super(lowerEndpoint, lowerBoundType, upperEndpoint, upperBoundType, comparableScalar);
  }

  get lowerEndpointValue(): number {
    return this.lowerEndpoint?.valueOf();
  }

  get upperEndpointValue(): number {
    return this.upperEndpoint?.valueOf();
  }

  /**
   * Returns a range that contains all values greater than or equal to lower and strictly less than upper.
   */
  static closedOpen(lower: Comparable, upper: Comparable): NumberRange {
    return new NumberRange(lower, BoundType.CLOSED, upper, BoundType.OPEN);
  }

  /**
   * Returns a range that contains all values greater than or equal to lower and less than or equal to upper.
   */
  static closed(lower: Comparable, upper: Comparable): NumberRange {
    return new NumberRange(lower, BoundType.CLOSED, upper, BoundType.CLOSED);
  }

  /**
   * Returns a range that contains all values strictly greater than lower and strictly less than upper.
   */
  static open(lower: Comparable, upper: Comparable): NumberRange {
    return new NumberRange(lower, BoundType.OPEN, upper, BoundType.OPEN);
  }

  /**
   * Returns a range that contains all values strictly greater than lower and less than or equal to upper.
   */
  static openClosed(lower: Comparable, upper: Comparable): NumberRange {
    return new NumberRange(lower, BoundType.OPEN, upper, BoundType.CLOSED);
  }

  /**
   * Returns a range that contains every value.
   */
  static all(): NumberRange {
    return new NumberRange(
      Number.NEGATIVE_INFINITY,
      BoundType.OPEN,
      Number.POSITIVE_INFINITY,
      BoundType.OPEN
    );
  }

  /**
   * Returns a range that contains all values greater than or equal to endpoint.
   */
  static atLeast(endpoint: Comparable): NumberRange {
    return new NumberRange(endpoint, BoundType.CLOSED, Number.POSITIVE_INFINITY, BoundType.OPEN);
  }

  /**
   * Returns a range that contains all values less than or equal to endpoint.
   */
  static atMost(endpoint: Comparable): NumberRange {
    return new NumberRange(Number.NEGATIVE_INFINITY, BoundType.OPEN, endpoint, BoundType.CLOSED);
  }

  /**
   * Returns a range from the given endpoint, which may be either inclusive (closed) or exclusive (open), with no upper bound.
   */
  static downTo(endpoint: Comparable, boundType: BoundType): NumberRange {
    return new NumberRange(endpoint, boundType, Number.POSITIVE_INFINITY, BoundType.OPEN);
  }

  /**
   * Returns a range with no lower bound up to the given endpoint, which may be either inclusive (closed) or exclusive (open).
   */
  static upTo(endpoint: Comparable, boundType: BoundType): NumberRange {
    return new NumberRange(Number.NEGATIVE_INFINITY, BoundType.OPEN, endpoint, boundType);
  }

  /**
   * Narrowed return types so the historical `NumberRange`-typed API is preserved
   * rather than widened to `Range<Comparable>` at every call site.
   */
  intersection(other: NumberRange | Range<Comparable>): NumberRange | null {
    const r = super.intersection(other);
    return r === null
      ? null
      : new NumberRange(r.lowerEndpoint, r.lowerBoundType, r.upperEndpoint, r.upperBoundType);
  }

  /** Narrowed return type; see `intersection`. */
  span(other: NumberRange | Range<Comparable>): NumberRange {
    const r = super.span(other);
    return new NumberRange(r.lowerEndpoint, r.lowerBoundType, r.upperEndpoint, r.upperBoundType);
  }
}
