import { BoundType } from "../core/bound-type";
import { Range } from "../range/range";

export interface RangeValue<T, P = any> {
  range: Range<P>;
  value: T;
}

/**
 * Order two ranges by their lower endpoint.
 *
 * This replaces the previous `a.lowerEndpoint.valueOf() - b.lowerEndpoint.valueOf()`
 * sort. Subtraction is wrong twice over for anything but small doubles: it
 * collapses precision past 2^53, and it throws outright on `bigint`
 * ("Cannot mix BigInt and other types"). A trichotomous compare is correct for
 * every scalar, and the domain's infinities are ordinary values of `T` that the
 * scalar already orders at the extremes, so no special case is needed here.
 */
function compareLower<P>(a: Range<P>, b: Range<P>): number {
  return a.scalar.compare(a.lowerEndpoint, b.lowerEndpoint);
}

/**
 * Build a new range of the SAME class as an existing one.
 *
 * RangeMap used to construct `new NumberRange(...)` directly, which meant a map
 * holding NumberRanges handed back NumberRanges — and tests (and consumers) that
 * compare with jasmine `toEqual` / `instanceof` depend on that. Now that the map
 * is generic, deriving the constructor from a range it already holds preserves
 * the subclass instead of flattening everything to the base `Range`.
 *
 * The scalar is passed as a 5th argument; subclasses with a 4-arg constructor
 * (NumberRange) simply ignore it, while `Range` itself uses it.
 */
function likeRange<P>(
  proto: Range<P>,
  lower: P,
  lowerBound: BoundType,
  upper: P,
  upperBound: BoundType
): Range<P> {
  const Ctor = proto.constructor as new (
    a: P,
    b: BoundType,
    c: P,
    d: BoundType,
    e?: unknown
  ) => Range<P>;
  return new Ctor(lower, lowerBound, upper, upperBound, proto.scalar);
}

/**
 * A Guava-style RangeMap: associates values with ranges of a point domain, and
 * coalesces/intersects them on write.
 *
 * `T` is the associated value type (unchanged from before). `P` is the POINT
 * domain, defaulting to `Comparable` so existing `new RangeMap<string>()` usage
 * compiles and behaves exactly as it did. To key the map on an exact domain,
 * pass it explicitly and use ranges built over the matching scalar:
 *
 *   const m = new RangeMap<string, bigint>();
 *   m.putCoalescing(R.closedOpen(9007199254740993n, 9007199254740995n), "a");
 *
 * The scalar travels with each range, so the map never has to know what the point
 * type is; it asks the range.
 */
export class RangeMap<T, P = any> {
  private rangeValues: RangeValue<T, P>[] = [];

  private static fromRangeValues<T, P>(
    values: RangeValue<T, P>[],
    eq?: (a: T, b: T) => boolean
  ): RangeMap<T, P> {
    const rangeMap = new RangeMap<T, P>(eq);
    rangeMap.rangeValues = values;
    return rangeMap;
  }

  constructor(private eq: (a: T, b: T) => boolean = (a, b) => a === b) {}

  put(range: Range<P>, value: T): void {
    this.combinedPut(range, value, false);
  }

  putCoalescing(range: Range<P>, value: T): void {
    this.combinedPut(range, value, true);
  }

  /**
   * Returns the value associated with the specified key, or null if there is no such value.
   */
  get(value: P): T | null {
    const foundRangeValue = this.rangeValues.find((currentRangeValue) =>
      currentRangeValue.range.contains(value)
    );
    if (foundRangeValue) {
      return foundRangeValue.value;
    }
    return null;
  }

  /**
   * Returns a sorted copy of current values in this RangeMap
   */
  asMapOfRanges(): Map<Range<P>, T> {
    const newMap = new Map<Range<P>, T>();
    this.rangeValues
      .filter((range) => !range.range.isEmpty())
      .sort((a, b) => compareLower(a.range, b.range))
      .forEach((currentRangeValue) => {
        newMap.set(currentRangeValue.range, currentRangeValue.value);
      });
    return newMap;
  }

  /**
   * Returns a sorted map with the provided value as the key
   */
  asMapOfValues(): Map<T, Range<P>[]> {
    const newMap = new Map<T, Range<P>[]>();
    this.rangeValues
      .filter((range) => !range.range.isEmpty())
      .sort((a, b) => compareLower(a.range, b.range))
      .forEach((currentRangeValue) => {
        const existing = newMap.get(currentRangeValue.value);
        if (existing) {
          existing.push(currentRangeValue.range);
        } else {
          newMap.set(currentRangeValue.value, [currentRangeValue.range]);
        }
      });
    return newMap;
  }

  /**
   * Returns a view of the part of this range map that intersects with range.
   */
  subRangeMap(range: Range<P>): RangeMap<T, P> {
    const rangeValues = this.rangeValues.flatMap((rangeValue) => {
      const intersection = rangeValue.range.intersection(range);

      if (!intersection) {
        return [];
      }

      return [
        {
          range: intersection,
          value: rangeValue.value,
        },
      ];
    });

    return RangeMap.fromRangeValues(rangeValues);
  }

  /**
   * Returns the range containing this key and its associated value, if such a range is present in the range map, or null otherwise.
   */
  getEntry(key: P): [Range<P>, T] | null {
    const foundRangeValue = this.rangeValues.find((currentRangeValue) =>
      currentRangeValue.range.contains(key)
    );
    if (foundRangeValue) {
      return [foundRangeValue.range, foundRangeValue.value];
    }
    return null;
  }

  /**
   * Returns the minimal range enclosing the ranges in this RangeMap.
   */
  span(): Range<P> | null {
    if (this.rangeValues.length === 0) {
      return null;
    }

    const sortedRangeValues = [...this.rangeValues].sort((a, b) =>
      compareLower(a.range, b.range)
    );

    const first = sortedRangeValues[0].range;
    const last = sortedRangeValues[sortedRangeValues.length - 1].range;

    return likeRange(
      first,
      first.lowerEndpoint,
      first.lowerBoundType,
      last.upperEndpoint,
      last.upperBoundType
    );
  }

  /**
   * Removes all associations from this range map in the specified range (optional operation).
   * If !range.contains(k), get(k) will return the same result before and after a call to remove(range). If range.contains(k), then after a call to remove(range), get(k) will return null.
   */
  remove(range: Range<P>): void {
    if (range.isEmpty()) {
      return;
    }

    const toDelete = {
      toDeleteId: Math.random(),
    };

    this.put(range, toDelete as unknown as T);

    this.rangeValues = this.rangeValues.filter(
      (rangeValue) => rangeValue.value !== (toDelete as unknown as T)
    );
  }

  /**
   * Both callers pass the flag explicitly, so it deliberately has no default:
   * a default here is a value no call site can exercise, and Stryker correctly
   * flagged that a flipped default changed nothing. `put` and `putCoalescing`
   * are the public surface; this stays an internal, fully-specified helper.
   */
  private combinedPut(
    range: Range<P>,
    value: T,
    shouldPutCoalescing: boolean
  ): void {
    let newRange: Range<P> = range;
    let affectedRangeValues: RangeValue<T, P>[] = [];
    const unaffectedRangeValues: RangeValue<T, P>[] = [];

    this.rangeValues.forEach((currentRangeValue) => {
      if (currentRangeValue.range.isConnected(newRange)) {
        affectedRangeValues.push(currentRangeValue);
      } else {
        unaffectedRangeValues.push(currentRangeValue);
      }
    });

    affectedRangeValues = affectedRangeValues.flatMap((currentRangeValue) => {
      if (shouldPutCoalescing && this.eq(value, currentRangeValue.value)) {
        // Should expand new range instead of inserting current
        newRange = newRange.span(currentRangeValue.range);
        return [];
      }

      if (currentRangeValue.range.intersection(newRange)?.isEmpty()) {
        // No overlap between ranges, preserve current range value
        return [currentRangeValue];
      }

      const s = newRange.scalar;

      // Everything strictly below the new range's lower bound. Built with
      // likeRange so a map of NumberRanges keeps yielding NumberRanges.
      const rangeBefore = currentRangeValue.range.intersection(
        likeRange(
          newRange,
          s.minusInfinity,
          BoundType.OPEN,
          newRange.lowerEndpoint,
          newRange.lowerBoundType === BoundType.OPEN ? BoundType.CLOSED : BoundType.OPEN
        )
      );

      // Everything strictly above the new range's upper bound.
      const rangeAfter = currentRangeValue.range.intersection(
        likeRange(
          newRange,
          newRange.upperEndpoint,
          newRange.upperBoundType === BoundType.OPEN ? BoundType.CLOSED : BoundType.OPEN,
          s.plusInfinity,
          BoundType.OPEN
        )
      );

      // Create new range values for any ranges that are not overlapped by the new range value
      return ([rangeBefore, rangeAfter] as Range<P>[])
        .filter((a) => !!a)
        .filter((a) => !a.isEmpty())
        .map((currentRange: Range<P>) => ({
          range: currentRange,
          value: currentRangeValue.value,
        }));
    });

    this.rangeValues = [
      ...unaffectedRangeValues,
      ...affectedRangeValues,
      {
        range: newRange,
        value,
      },
    ];
  }
}
