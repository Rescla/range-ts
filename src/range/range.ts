import { BoundType } from "../core/bound-type";
import { Scalar } from "../core/scalar";

/**
 * Where a bound sits on the line, as a tie-break offset used only when two
 * endpoint VALUES are equal.
 *
 * A bound is not a point. `[3..` admits 3; `(3..` begins just above it. Two
 * bounds carrying the same value can therefore occupy different positions, and
 * the position depends on BOTH the open/closed type AND whether the bound is a
 * lower or an upper one:
 *
 *   lower CLOSED(v) -> side 0      lower OPEN(v) -> side 1   (begins above v)
 *   upper CLOSED(v) -> side 1      upper OPEN(v) -> side 0   (ends below v)
 *
 * This is Guava's `Cut` ordering (`belowValue` / `aboveValue`) expressed as a
 * comparison tie-break instead of as a new value of `T`: the domain's own
 * `compare` decides the value and the side only ever breaks a tie between equal
 * values, so nothing here invents a number the consumer could hold, overflow or
 * fail to order. See `compareCuts`.
 */
function lowerSide(boundType: BoundType): number {
  return boundType === BoundType.OPEN ? 1 : 0;
}

/** Mirror of `lowerSide` for the upper end — note the polarity is inverted. */
function upperSide(boundType: BoundType): number {
  return boundType === BoundType.OPEN ? 0 : 1;
}

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
   * Compare one of this range's bounds against one of `other`'s, in cut order:
   * by endpoint value first, by the position the bound occupies at that value
   * second.
   *
   * An unordered comparison propagates as `NaN` rather than falling through to
   * the side tie-break: `NaN !== 0` is true, so the value comparison is what
   * gets returned and every `<=` / `>=` / `===` at the call sites reads false.
   * That is the established behaviour for unordered endpoints (see the
   * `Scalar.compare` contract) and keeps an unordered pair from being resolved by
   * a bound-type technicality.
   *
   * The one case that propagation cannot serve honestly is two ranges built over
   * DIFFERENT scalars whose comparison comes back unordered. There the caller is
   * not asking a range question that happens to have a negative answer; it is
   * asking a question no scalar is answering. Propagating the `NaN` there reads
   * as "not contained / not connected / no overlap", which is how a `bigint`
   * endpoint ends up reported as outside a range whose own endpoint it equals
   * (`comparableScalar.compare(10, 10n)` is `NaN`, so
   * `NumberRange.closed(0, 10).contains(10n)` is `false`). A wrong answer
   * wearing the costume of a negative one is the worst possible output, so that
   * specific case throws.
   *
   * Note the guard fires only on the unordered result. Two distinct-but-equivalent
   * scalar objects that DO order the values compare normally, so nothing that was
   * previously answering correctly changes.
   */
  private compareCuts(
    other: Range<T>,
    myValue: T,
    mySide: number,
    theirValue: T,
    theirSide: number
  ): number {
    const byValue = this.scalar.compare(myValue, theirValue);

    if (this.scalar !== other.scalar && Number.isNaN(byValue)) {
      throw new Error(
        "Range: compared endpoints across two different Scalar implementations " +
          "and the comparison came back unordered. These ranges were built over " +
          "different point domains and cannot be intersected, spanned, enclosed " +
          "or connected. Build both ranges from the same scalar " +
          "(defineRange(yourScalar)) rather than mixing domains."
      );
    }

    // Unordered operands fall through here as NaN, and `NaN !== 0` is true, so
    // the NaN propagates rather than reaching the side tie-break.
    return byValue !== 0 ? byValue : mySide - theirSide;
  }

  /**
   * Returns true if the bounds of other do not extend outside the bounds of this range.
   *
   * Compared in cut order, which is what makes the empty cases come out right.
   * A test built on `contains(other.endpoint)` cannot: `contains` answers a
   * question about the WHOLE range, so for an empty `other` it is false at both
   * ends for reasons that have nothing to do with either bound, and a range that
   * plainly contains the empty range reads as not enclosing it. Guava's own
   * contract calls this out — `[3..6]` encloses `[4..4)` even though the latter
   * is empty — and cut order is how it gets there:
   *
   *   [3..6]  lower cut (3,0)  upper cut (6,1)
   *   [4..4)  lower cut (4,0)  upper cut (4,0)   -> 3<=4 and 6>=4 -> enclosed
   *
   * Note the converse does NOT hold, also per Guava: `[4..5]` contains every
   * value that `(3..6)` contains, but does not enclose it.
   */
  encloses(other: Range<T>): boolean {
    const lowerOk =
      this.compareCuts(
        other,
        this.lowerEndpoint,
        lowerSide(this.lowerBoundType),
        other.lowerEndpoint,
        lowerSide(other.lowerBoundType)
      ) <= 0;

    const upperOk =
      this.compareCuts(
        other,
        this.upperEndpoint,
        upperSide(this.upperBoundType),
        other.upperEndpoint,
        upperSide(other.upperBoundType)
      ) >= 0;

    return lowerOk && upperOk;
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

    // The higher lower cut and the lower upper cut, taken as whole cuts so the
    // open/closed type travels with the position instead of being re-derived by
    // a tie-break rule that has to guess which side won.
    const lowerIsFromThis =
      this.compareCuts(
        other,
        this.lowerEndpoint,
        lowerSide(this.lowerBoundType),
        other.lowerEndpoint,
        lowerSide(other.lowerBoundType)
      ) >= 0;

    const upperIsFromThis =
      this.compareCuts(
        other,
        this.upperEndpoint,
        upperSide(this.upperBoundType),
        other.upperEndpoint,
        upperSide(other.upperBoundType)
      ) <= 0;

    const lower = lowerIsFromThis ? this : other;
    const upper = upperIsFromThis ? this : other;

    return new Range<T>(
      lower.lowerEndpoint,
      lower.lowerBoundType,
      upper.upperEndpoint,
      upper.upperBoundType,
      this.scalar
    );
  }

  /**
   * Returns true if there exists a (possibly empty) range which is enclosed by
   * both this range and other.
   *
   * This is overlap-or-endpoint-touch, matching the historical contract, and is
   * decided on cuts rather than on `contains` so that an EMPTY range can still
   * be connected: `[0..2)` and the empty `[2..2)` both enclose `[2..2)` and so
   * are connected, which a `contains`-based test cannot see because an empty
   * range contains nothing at either end.
   *
   * On a DISCRETE domain you usually also want to know whether two ranges sit
   * immediately next to each other with nothing in between — that is
   * `isAdjacentTo`, which needs `succ` on the scalar.
   */
  isConnected(other: Range<T>): boolean {
    const thisStartsBeforeOtherEnds =
      this.compareCuts(
        other,
        this.lowerEndpoint,
        lowerSide(this.lowerBoundType),
        other.upperEndpoint,
        upperSide(other.upperBoundType)
      ) <= 0;

    const otherStartsBeforeThisEnds =
      this.compareCuts(
        other,
        other.lowerEndpoint,
        lowerSide(other.lowerBoundType),
        this.upperEndpoint,
        upperSide(this.upperBoundType)
      ) <= 0;

    return thisStartsBeforeOtherEnds && otherStartsBeforeThisEnds;
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
    // The lower of the two lower cuts and the higher of the two upper cuts.
    const lowerIsFromThis =
      this.compareCuts(
        other,
        this.lowerEndpoint,
        lowerSide(this.lowerBoundType),
        other.lowerEndpoint,
        lowerSide(other.lowerBoundType)
      ) <= 0;

    const upperIsFromThis =
      this.compareCuts(
        other,
        this.upperEndpoint,
        upperSide(this.upperBoundType),
        other.upperEndpoint,
        upperSide(other.upperBoundType)
      ) >= 0;

    const lower = lowerIsFromThis ? this : other;
    const upper = upperIsFromThis ? this : other;

    return new Range<T>(
      lower.lowerEndpoint,
      lower.lowerBoundType,
      upper.upperEndpoint,
      upper.upperBoundType,
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
