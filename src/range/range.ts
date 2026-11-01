import { BoundType } from "../core/bound-type";
import { Scalar } from "../core/scalar";

/**
 * A range (or "interval") around a contiguous span of values of some scalar
 * domain `T`, with each side independently open or closed.
 *
 * This is the generic core. Every ordering decision goes through the `Scalar<T>`
 * passed in, so the same machinery serves any point domain — JS `number`,
 * native `bigint`, a decimal, a fixed-point money type, a version tuple — as
 * long as the consumer can describe how to compare it. The library itself never
 * converts endpoints to another type and never assumes they are doubles.
 *
 * UNBOUNDED SIDES ARE VALUES, NOT ABSENCES
 * ---------------------------------------
 * An unbounded side holds the scalar's own `minusInfinity` / `plusInfinity`.
 * Those are real values of `T` that the scalar guarantees to order at the
 * extremes, so there is no `null`, no `undefined`, and no special-casing in the
 * comparison logic below: an unbounded range compares exactly like a bounded one
 * with an extreme endpoint. Which side is unbounded is read with
 * `isBoundedBelow()` / `isBoundedAbove()`, never by inspecting the value.
 *
 * Note that it is not possible to iterate over the contained values.
 *
 * Based off of
 * https://guava.dev/releases/19.0/api/docs/com/google/common/collect/Range.html
 */
export class Range<T> {
  constructor(
    public lowerEndpoint: T,
    public lowerBoundType: BoundType,
    public upperEndpoint: T,
    public upperBoundType: BoundType,
    public scalar: Scalar<T>
  ) {}

  /**
   * True if this range has a real lower bound, i.e. the lower side is not
   * unbounded.
   *
   * THIS IS THE INTENDED WAY TO ASK. Consumers should not compare a raw endpoint
   * against `Infinity`, a sentinel, or anything else: the representation of
   * "unbounded" differs by domain (native `±Infinity` for `number`, explicit
   * sentinel strings for `bigint`) and is an implementation detail. Asking with
   * a direction also makes it impossible to confuse the two ends — a single
   * "is this infinity" predicate would invite exactly that mistake, so there
   * isn't one.
   */
  isBoundedBelow(): boolean {
    return !this.scalar.isMinusInfinity(this.lowerEndpoint);
  }

  /** True if this range has a real upper bound. See `isBoundedBelow`. */
  isBoundedAbove(): boolean {
    return !this.scalar.isPlusInfinity(this.upperEndpoint);
  }

  /**
   * The lower endpoint, asserted to be a real bound.
   * Throws on an unbounded range instead of returning a sentinel, so an
   * unbounded range cannot be mistaken for a bounded one downstream.
   */
  lowerEndpointOrThrow(): T {
    if (!this.isBoundedBelow()) {
      throw new Error("Range is unbounded below; there is no lower endpoint.");
    }
    return this.lowerEndpoint;
  }

  /** The upper endpoint, asserted to be a real bound. See `lowerEndpointOrThrow`. */
  upperEndpointOrThrow(): T {
    if (!this.isBoundedAbove()) {
      throw new Error("Range is unbounded above; there is no upper endpoint.");
    }
    return this.upperEndpoint;
  }

  /**
   * Returns true if value is within the bounds of this range.
   */
  contains(value: T): boolean {
    const aboveLowerEndpoint =
      this.lowerBoundType === BoundType.OPEN
        ? this.scalar.compare(this.lowerEndpoint, value) < 0
        : this.scalar.compare(this.lowerEndpoint, value) <= 0;

    const belowUpperEndpoint =
      this.upperBoundType === BoundType.OPEN
        ? this.scalar.compare(this.upperEndpoint, value) > 0
        : this.scalar.compare(this.upperEndpoint, value) >= 0;

    return aboveLowerEndpoint && belowUpperEndpoint;
  }

  /**
   * Returns true if the bounds of other do not extend outside the bounds of this range.
   */
  encloses(other: Range<T>): boolean {
    const lowerEndpointEnclosed =
      other.lowerBoundType === BoundType.OPEN
        ? this.contains(other.lowerEndpoint) || this.scalar.compare(this.lowerEndpoint, other.lowerEndpoint) === 0
        : this.contains(other.lowerEndpoint);

    const upperEndpointEnclosed =
      other.upperBoundType === BoundType.OPEN
        ? this.contains(other.upperEndpoint) || this.scalar.compare(this.upperEndpoint, other.upperEndpoint) === 0
        : this.contains(other.upperEndpoint);

    return lowerEndpointEnclosed && upperEndpointEnclosed;
  }

  /**
   * Returns true if the ranges overlap in any way
   */
  overlaps(other: Range<T>): boolean {
    const intersection = this.intersection(other);
    return (intersection && !intersection.isEmpty()) ?? false;
  }

  /**
   * Returns the maximal range enclosed by both this range and other, if such a range exists.
   */
  intersection(other: Range<T>): Range<T> | null {
    if (!this.isConnected(other)) {
      return null;
    }

    const cmpLower = this.scalar.compare(this.lowerEndpoint, other.lowerEndpoint);
    const cmpUpper = this.scalar.compare(this.upperEndpoint, other.upperEndpoint);

    // The range with the higher lower bound, and the range with the lower upper bound.
    const lowerRange = cmpLower <= 0 ? other : this;
    const upperRange = cmpUpper >= 0 ? other : this;

    let lowerBoundType: BoundType;
    let upperBoundType: BoundType;

    if (cmpLower === 0) {
      lowerBoundType =
        this.lowerBoundType === BoundType.OPEN || other.lowerBoundType === BoundType.OPEN
          ? BoundType.OPEN
          : BoundType.CLOSED;
    } else {
      lowerBoundType = lowerRange.lowerBoundType;
    }

    if (cmpUpper === 0) {
      upperBoundType =
        this.upperBoundType === BoundType.OPEN || other.upperBoundType === BoundType.OPEN
          ? BoundType.OPEN
          : BoundType.CLOSED;
    } else {
      upperBoundType = upperRange.upperBoundType;
    }

    return new Range<T>(
      lowerRange.lowerEndpoint,
      lowerBoundType,
      upperRange.upperEndpoint,
      upperBoundType,
      this.scalar
    );
  }

  /**
   * Returns true if there exists a (possibly empty) range which is enclosed by
   * both this range and other.
   *
   * This is overlap-or-endpoint-touch, matching the historical contract. On a
   * DISCRETE domain you usually also want to know whether two ranges sit
   * immediately next to each other with nothing in between — that is
   * `isAdjacentTo`, which needs `succ` on the scalar.
   */
  isConnected(other: Range<T>): boolean {
    return (
      this.contains(other.lowerEndpoint) ||
      this.contains(other.upperEndpoint) ||
      other.contains(this.lowerEndpoint) ||
      other.contains(this.upperEndpoint)
    );
  }

  /**
   * Returns true if this range and other are consecutive with nothing between
   * them: one ends exactly one step below where the other begins.
   *
   * Only meaningful on a DISCRETE domain. Returns false when the scalar does
   * not define `succ` (a continuous domain has no "next value", so adjacency
   * cannot be asserted), and treats a throwing `succ` as "not adjacent" rather
   * than propagating — which is what happens at the infinities.
   *
   * This is the property a consumer with 64-bit ids needs and the JS-number
   * path cannot give: at ~1.5e18 the double spacing is 256, so `x + 1 === x`
   * and adjacency is indistinguishable from equality.
   */
  isAdjacentTo(other: Range<T>): boolean {
    const s = this.scalar;
    if (!s.succ) return false;

    const step = (v: T): T | null => {
      try {
        return s.succ!(v);
      } catch {
        return null;
      }
    };

    // this ends exactly where other begins
    if (
      this.upperBoundType === BoundType.CLOSED &&
      other.lowerBoundType === BoundType.CLOSED
    ) {
      const nxt = step(this.upperEndpoint);
      if (nxt !== null && s.compare(nxt, other.lowerEndpoint) === 0) return true;
    }

    // other ends exactly where this begins
    if (
      other.upperBoundType === BoundType.CLOSED &&
      this.lowerBoundType === BoundType.CLOSED
    ) {
      const nxt = step(other.upperEndpoint);
      if (nxt !== null && s.compare(nxt, this.lowerEndpoint) === 0) return true;
    }

    return false;
  }

  /**
   * Returns true if this range is of the form [v..v) or (v..v].
   */
  isEmpty(): boolean {
    return (
      this.scalar.compare(this.lowerEndpoint, this.upperEndpoint) === 0 &&
      (this.lowerBoundType === BoundType.OPEN || this.upperBoundType === BoundType.OPEN)
    );
  }

  /**
   * Returns the minimal range that encloses both this range and other.
   */
  span(other: Range<T>): Range<T> {
    const cmpLower = this.scalar.compare(this.lowerEndpoint, other.lowerEndpoint);
    const cmpUpper = this.scalar.compare(this.upperEndpoint, other.upperEndpoint);

    // The range with the lower lower bound, and the range with the higher upper bound.
    const lowerRange = cmpLower <= 0 ? this : other;
    const upperRange = cmpUpper >= 0 ? this : other;

    let lowerBoundType: BoundType;
    let upperBoundType: BoundType;

    if (cmpLower === 0) {
      lowerBoundType =
        this.lowerBoundType === BoundType.CLOSED || other.lowerBoundType === BoundType.CLOSED
          ? BoundType.CLOSED
          : BoundType.OPEN;
    } else {
      lowerBoundType = lowerRange.lowerBoundType;
    }

    if (cmpUpper === 0) {
      upperBoundType =
        this.upperBoundType === BoundType.CLOSED || other.upperBoundType === BoundType.CLOSED
          ? BoundType.CLOSED
          : BoundType.OPEN;
    } else {
      upperBoundType = upperRange.upperBoundType;
    }

    return new Range<T>(
      lowerRange.lowerEndpoint,
      lowerBoundType,
      upperRange.upperEndpoint,
      upperBoundType,
      this.scalar
    );
  }

  /**
   * Returns a string representation of this range, such as "[3..5)".
   * The scalar renders its own infinities, so the output is identical across
   * domains that model them differently.
   */
  toString(): string {
    const lower = this.lowerBoundType === BoundType.OPEN ? "(" : "[";
    const upper = this.upperBoundType === BoundType.OPEN ? ")" : "]";
    const fmt = (v: T): string => (this.scalar.format ? this.scalar.format(v) : String(v));
    return `${lower}${fmt(this.lowerEndpoint)}..${fmt(this.upperEndpoint)}${upper}`;
  }
}

/**
 * A static-style constructor set bound to one scalar, so a consumer can write
 * `const R = defineRange(bigintScalar); R.closedOpen(a, b)` instead of passing
 * the scalar to every construction site.
 */
export interface RangeFactory<T> {
  readonly scalar: Scalar<T>;

  /**
   * The domain's "less than everything" value, named explicitly so code that
   * genuinely needs it does not hardcode `Number.NEGATIVE_INFINITY` and break on
   * another domain. Prefer `range.isBoundedBelow()` for questions.
   */
  readonly negativeInfinity: T;

  /** The domain's "greater than everything" value, named explicitly. */
  readonly positiveInfinity: T;

  /** >= lower, < upper */
  closedOpen(lower: T, upper: T): Range<T>;
  /** >= lower, <= upper */
  closed(lower: T, upper: T): Range<T>;
  /** > lower, < upper */
  open(lower: T, upper: T): Range<T>;
  /** > lower, <= upper */
  openClosed(lower: T, upper: T): Range<T>;
  /** every value */
  all(): Range<T>;
  /** >= endpoint, unbounded above */
  atLeast(endpoint: T): Range<T>;
  /** unbounded below, <= endpoint */
  atMost(endpoint: T): Range<T>;
  /** from endpoint (bound as given) up to unbounded */
  downTo(endpoint: T, boundType: BoundType): Range<T>;
  /** unbounded below up to endpoint (bound as given) */
  upTo(endpoint: T, boundType: BoundType): Range<T>;
}

/**
 * Bind the range constructors to a scalar. The unbounded sides are filled with
 * the scalar's own infinities, which are values of `T` like any other.
 */
export function defineRange<T>(scalar: Scalar<T>): RangeFactory<T> {
  const negInf = scalar.minusInfinity;
  const posInf = scalar.plusInfinity;
  return {
    scalar,
    negativeInfinity: negInf,
    positiveInfinity: posInf,
    closedOpen: (lower, upper) =>
      new Range<T>(lower, BoundType.CLOSED, upper, BoundType.OPEN, scalar),
    closed: (lower, upper) =>
      new Range<T>(lower, BoundType.CLOSED, upper, BoundType.CLOSED, scalar),
    open: (lower, upper) =>
      new Range<T>(lower, BoundType.OPEN, upper, BoundType.OPEN, scalar),
    openClosed: (lower, upper) =>
      new Range<T>(lower, BoundType.OPEN, upper, BoundType.CLOSED, scalar),
    all: () => new Range<T>(negInf, BoundType.OPEN, posInf, BoundType.OPEN, scalar),
    atLeast: (endpoint) => new Range<T>(endpoint, BoundType.CLOSED, posInf, BoundType.OPEN, scalar),
    atMost: (endpoint) => new Range<T>(negInf, BoundType.OPEN, endpoint, BoundType.CLOSED, scalar),
    downTo: (endpoint, boundType) =>
      new Range<T>(endpoint, boundType, posInf, BoundType.OPEN, scalar),
    upTo: (endpoint, boundType) =>
      new Range<T>(negInf, BoundType.OPEN, endpoint, boundType, scalar),
  };
}
