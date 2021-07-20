import { NumberRange } from "../number-range/number-range";
import { BoundType } from "../core/bound-type";

export interface RangeValue<T> {
  range: NumberRange;
  value: T;
}

export class RangeMap<T> {
  private rangeValues: RangeValue<T>[] = [];

  private static fromRangeValues<T>(
    values: RangeValue<T>[],
    eq?: (a: T, b: T) => boolean
  ): RangeMap<T> {
    const rangeMap = new RangeMap<T>(eq);
    rangeMap.rangeValues = values;
    return rangeMap;
  }

  constructor(private eq: (a: T, b: T) => boolean = (a, b) => a === b) {}

  put(range: NumberRange, value: T): void {
    this.combinedPut(range, value, false);
  }

  putCoalescing(range: NumberRange, value: T): void {
    this.combinedPut(range, value, true);
  }

  /**
   * Returns the value associated with the specified key, or null if there is no such value.
   */
  get(value: number): T | null {
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
  asMapOfRanges(): Map<NumberRange, T> {
    const newMap = new Map();
    this.rangeValues
      .filter((range) => !range.range.isEmpty())
      .sort(
        (a, b) =>
          a.range.lowerEndpoint.valueOf() - b.range.lowerEndpoint.valueOf()
      )
      .forEach((currentRangeValue) => {
        newMap.set(currentRangeValue.range, currentRangeValue.value);
      });
    return newMap;
  }

  /**
   * Returns a sorted map with the provided value as the key
   */
  asMapOfValues(): Map<T, NumberRange[]> {
    const newMap = new Map();
    this.rangeValues
      .filter((range) => !range.range.isEmpty())
      .sort(
        (a, b) =>
          a.range.lowerEndpoint.valueOf() - b.range.lowerEndpoint.valueOf()
      )
      .forEach((currentRangeValue) => {
        if (newMap.has(currentRangeValue.value)) {
          newMap.get(currentRangeValue.value).push(currentRangeValue.range);
        } else {
          newMap.set(currentRangeValue.value, [currentRangeValue.range]);
        }
      });
    return newMap;
  }

  /**
   * Returns a view of the part of this range map that intersects with range.
   */
  subRangeMap(range: NumberRange): RangeMap<T> {
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
  getEntry(key: number): [NumberRange, T] | null {
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
  span(): NumberRange | null {
    if (this.rangeValues.length === 0) {
      return null;
    }

    const sortedRangeValues = this.rangeValues.sort(
      (a, b) =>
        a.range.lowerEndpoint.valueOf() - b.range.lowerEndpoint.valueOf()
    );

    return new NumberRange(
      sortedRangeValues[0].range.lowerEndpoint,
      sortedRangeValues[0].range.lowerBoundType,
      sortedRangeValues[sortedRangeValues.length - 1].range.upperEndpoint,
      sortedRangeValues[sortedRangeValues.length - 1].range.upperBoundType
    );
  }

  /**
   * Removes all associations from this range map in the specified range (optional operation).
   * If !range.contains(k), get(k) will return the same result before and after a call to remove(range). If range.contains(k), then after a call to remove(range), get(k) will return null.
   */
  remove(range: NumberRange): void {
    if(range.isEmpty()) {
      return;
    }

    const toDelete = {
      toDeleteId: Math.random()
    };

    this.put(range, toDelete as any);

    // @ts-ignore
    this.rangeValues = this.rangeValues.filter(rangeValue => rangeValue.value !== toDelete);
  }

  private combinedPut(
    range: NumberRange,
    value: T,
    shouldPutCoalescing: boolean = false
  ): void {
    let newRange: NumberRange = range;
    let affectedRangeValues: RangeValue<T>[] = [];
    const unaffectedRangeValues: RangeValue<T>[] = [];

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

      const rangeBefore = currentRangeValue.range.intersection(
        NumberRange.upTo(
          newRange.lowerEndpoint,
          newRange.lowerBoundType === BoundType.OPEN
            ? BoundType.CLOSED
            : BoundType.OPEN
        )
      );
      const rangeAfter = currentRangeValue.range.intersection(
        new NumberRange(
          newRange.upperEndpoint,
          newRange.upperBoundType === BoundType.OPEN
            ? BoundType.CLOSED
            : BoundType.OPEN,
          Number.POSITIVE_INFINITY,
          BoundType.OPEN
        )
      );

      // Create new range values for any ranges that are not overlapped by the new range value
      return ([rangeBefore, rangeAfter] as NumberRange[])
        .filter((a) => !!a)
        .map((currentRange: NumberRange) => ({
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
