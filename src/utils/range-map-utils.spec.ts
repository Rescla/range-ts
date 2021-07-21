import {RangeMap} from '../range-map/range-map';
import {isEqual, result} from 'lodash-es';
import {NumberRange} from '../number-range/number-range';

describe('Range map utils', () => {
  it('should correctly add items in an infinite range with empty array', () => {
    const rangeMap = new RangeMap(isEqual);

    rangeMap.put(NumberRange.all(), []);
    rangeMap.putCoalescing(NumberRange.closedOpen(1834354800000, 1834441200000), 'ab934de2-99be-4d01-8086-9b21082665c9');
    check();
    rangeMap.putCoalescing(NumberRange.closedOpen(1751320800000, 1751493600000), 'e4fe9b11-b33b-4a9d-8f82-893fa543d8ed');
    check();
    rangeMap.putCoalescing(NumberRange.closedOpen(1751320800000, 1752098400000), 'a546e6f6-796c-45c9-9ea1-91610d23ef04');
    check();

    function check() {
      const resultEntries = [...rangeMap.asMapOfRanges().entries()];
      expect(resultEntries.some(([range, value]) => range.lowerEndpoint === Number.NEGATIVE_INFINITY)).toBeTrue();
      expect(resultEntries.some(([range, value]) => range.upperEndpoint === Number.POSITIVE_INFINITY)).toBeTrue();
    }
  })
})
