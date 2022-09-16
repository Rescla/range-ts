import { BoundType } from "../core/bound-type";
import { Comparable } from "../core/comparable";

/**
 * A range (or "interval") defines the boundaries around a contiguous span of values of comparables.
 * Note that it is not possible to iterate over these contained values.
 *
 * Based off of https://guava.dev/releases/19.0/api/docs/com/google/common/collect/Range.html#intersection(com.google.common.collect.Range)
 */
export class NumberRange {
  constructor(
    public lowerEndpoint: Comparable,
    public lowerBoundType: BoundType,
    public upperEndpoint: Comparable,
    public upperBoundType: BoundType
  ) {}

  get lowerEndpointValue(): number {
    return this.lowerEndpoint?.valueOf();
  }

  get upperEndpointValue(): number {
    return this.upperEndpoint?.valueOf()
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
    return new NumberRange(
      endpoint,
      BoundType.CLOSED,
      Number.POSITIVE_INFINITY,
      BoundType.OPEN
    );
  }

  /**
   * Returns a range that contains all values less than or equal to endpoint.
   */
  static atMost(endpoint: Comparable): NumberRange {
    return new NumberRange(
      Number.NEGATIVE_INFINITY,
      BoundType.OPEN,
      endpoint,
      BoundType.CLOSED
    );
  }

  /**
   * Returns a range from the given endpoint, which may be either inclusive (closed) or exclusive (open), with no upper bound.
   */
  static downTo(endpoint: Comparable, boundType: BoundType): NumberRange {
    return new NumberRange(
      endpoint,
      boundType,
      Number.POSITIVE_INFINITY,
      BoundType.OPEN
    );
  }

  /**
   * Returns a range with no lower bound up to the given endpoint, which may be either inclusive (closed) or exclusive (open).
   */
  static upTo(endpoint: Comparable, boundType: BoundType): NumberRange {
    return new NumberRange(
      Number.NEGATIVE_INFINITY,
      BoundType.OPEN,
      endpoint,
      boundType
    );
  }

  /**
   * Returns true if value is within the bounds of this range.
   */
  contains(comparable: Comparable): boolean {
    const value = comparable?.valueOf();
    const aboveLowerEndpoint =
      this.lowerBoundType === BoundType.OPEN
        ? this.lowerEndpointValue < value
        : this.lowerEndpointValue <= value;
    const belowUpperEndpoint =
      this.upperBoundType === BoundType.OPEN
        ? this.upperEndpointValue > value
        : this.upperEndpointValue >= value;
    return aboveLowerEndpoint && belowUpperEndpoint;
  }

  /**
   * Returns true if the bounds of other do not extend outside the bounds of this range.
   */
  encloses(other: NumberRange): boolean {
    const lowerEndpointEnclosed =
      other.lowerBoundType === BoundType.OPEN
        ? this.contains(other.lowerEndpoint) ||
          this.lowerEndpointValue === other.lowerEndpointValue
        : this.contains(other.lowerEndpoint);
    const upperEndpointEnclosed =
      other.upperBoundType === BoundType.OPEN
        ? this.contains(other.upperEndpoint) ||
          this.upperEndpointValue === other.upperEndpointValue
        : this.contains(other.upperEndpoint);
    return lowerEndpointEnclosed && upperEndpointEnclosed;
  }

  /**
   * Returns true if the ranges overlap in any way
   */
  overlaps(other: NumberRange): boolean {
    const intersection = this.intersection(other);
    return (intersection && !intersection.isEmpty()) ?? false;
  }

  /**
   * Returns the maximal range enclosed by both this range and connectedRange, if such a range exists.
   */
  intersection(other: NumberRange): NumberRange | null {
    if (!this.isConnected(other)) {
      return null;
    }

    // Determine inner ranges
    const lowerRange = this.lowerEndpointValue <= other.lowerEndpointValue ? other : this;
    const upperRange = this.upperEndpointValue >= other.upperEndpointValue ? other : this;

    // Determine bound types
    let lowerBoundType;
    let upperBoundType;

    if (this.lowerEndpointValue === other.lowerEndpointValue) {
      lowerBoundType =
        this.lowerBoundType === BoundType.OPEN ||
        other.lowerBoundType === BoundType.OPEN
          ? BoundType.OPEN
          : BoundType.CLOSED;
    } else {
      lowerBoundType = lowerRange.lowerBoundType;
    }

    if (this.upperEndpointValue === other.upperEndpointValue) {
      upperBoundType =
        this.upperBoundType === BoundType.OPEN ||
        other.upperBoundType === BoundType.OPEN
          ? BoundType.OPEN
          : BoundType.CLOSED;
    } else {
      upperBoundType = upperRange.upperBoundType;
    }

    return new NumberRange(
      lowerRange.lowerEndpoint,
      lowerBoundType,
      upperRange.upperEndpoint,
      upperBoundType
    );
  }

  /**
   * Returns true if there exists a (possibly empty) range which is enclosed by both this range and other.
   */
  isConnected(other: NumberRange): boolean {
    return (
      this.contains(other.lowerEndpoint) ||
      this.contains(other.upperEndpoint) ||
      other.contains(this.lowerEndpoint) ||
      other.contains(this.upperEndpoint)
    );
  }

  /**
   * Returns true if this range is of the form [v..v) or (v..v].
   */
  isEmpty(): boolean {
    return (
      this.lowerEndpointValue === this.upperEndpointValue &&
      (this.lowerBoundType === BoundType.OPEN ||
        this.upperBoundType === BoundType.OPEN)
    );
  }

  /**
   * Returns the minimal range that encloses both this range and other.
   */
  span(other: NumberRange): NumberRange {
    // Determine outer ranges
    const lowerRange = this.lowerEndpointValue <= other.lowerEndpointValue ? this : other;
    const upperRange = this.upperEndpointValue >= other.upperEndpointValue ? this : other;

    // Determine bound types
    let lowerBoundType;
    let upperBoundType;

    if (this.lowerEndpointValue === other.lowerEndpointValue) {
      lowerBoundType =
        this.lowerBoundType === BoundType.CLOSED ||
        other.lowerBoundType === BoundType.CLOSED
          ? BoundType.CLOSED
          : BoundType.OPEN;
    } else {
      lowerBoundType = lowerRange.lowerBoundType;
    }

    if (this.upperEndpointValue === other.upperEndpointValue) {
      upperBoundType =
        this.upperBoundType === BoundType.CLOSED ||
        other.upperBoundType === BoundType.CLOSED
          ? BoundType.CLOSED
          : BoundType.OPEN;
    } else {
      upperBoundType = upperRange.upperBoundType;
    }

    return new NumberRange(
      lowerRange.lowerEndpoint,
      lowerBoundType,
      upperRange.upperEndpoint,
      upperBoundType
    );
  }

  /**
   * Returns a string representation of this range, such as "[3..5)". See tests, class docs or guava RangeMap docs for more examples.
   */
  toString(): string {
    const getLowerBoundCharacter = () => {
      switch (this.lowerBoundType) {
        case BoundType.OPEN:
          return "(";
        case BoundType.CLOSED:
          return "[";
      }
    };

    const getUpperBoundCharacter = () => {
      switch (this.upperBoundType) {
        case BoundType.OPEN:
          return ")";
        case BoundType.CLOSED:
          return "]";
      }
    };

    const valueToString = (value: Comparable) => {
      switch (value.valueOf()) {
        case Number.POSITIVE_INFINITY:
          return "+∞";
        case Number.NEGATIVE_INFINITY:
          return "-∞";
        default:
          // @ts-ignore
          if(value['toISOString']) {
            // @ts-ignore
            return value.toISOString();
          }

          return value.valueOf();
      }
    };

    return `${getLowerBoundCharacter()}${valueToString(
      this.lowerEndpoint
    )}..${valueToString(this.upperEndpoint)}${getUpperBoundCharacter()}`;
  }
}
