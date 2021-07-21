import {RangeMap} from '../range-map/range-map';
import {NumberRange} from '../number-range/number-range';

export class RangeMapUtils {
  /**
   * Add the provided value to every entry in the provided rangeMap.
   */
  static addToRangeIfNotExists<T>(rangeMap: RangeMap<T[]>, range: NumberRange, value: T) {
    const subMapOfRanges = rangeMap.subRangeMap(range).asMapOfRanges();

    [...subMapOfRanges.entries()].forEach(([range, currentValuesForRange]) => {
      if (!currentValuesForRange.includes(value)) {
        rangeMap.putCoalescing(range, [...currentValuesForRange, value]);
      }
    });
  }
}
