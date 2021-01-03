# RangeTs

![CI](https://github.com/Rescla/range-ts/workflows/CI/badge.svg)
[![Test Coverage](https://api.codeclimate.com/v1/badges/a98503501886a6965e4a/test_coverage)](https://codeclimate.com/github/Rescla/range-ts/test_coverage)

Typescript ranges based on Guava RangeMap.

The library is available as an npm package. To install the package run:

```
npm install range-ts --save
# or with yarn
yarn add range-ts
```

## Concepts

### NumberRange

Defines a range between two values defined by Numbers and Bound Types. The name NumberRange is used to distinguish from the DOM Range class.

The NumberRange class has a toString to aid in readability. The `[]` and `()` symbols are used to indicate a Closed and Open bound type respectively. Some examples:

| toString() | Definition             |
| ---------- | ---------------------- |
| `[1..2]`   | x >= 1 && x <= 2       |
| `(2..5]`   | x > 2 && x <= 5        |
| `[-∞..2]`  | x <= 2                 |
| `(-∞..2)`  | x > -Infinity && x < 2 |

See also: https://guava.dev/releases/19.0/api/docs/com/google/common/collect/Range.html

Ranges can, as an example, also be used to define a period of time with Dates, where the Dates are used to define the day.
To define a full day, ClosedOpen can be used.

```typescript
// Example with DateFns
const now = new Date(); // Sun Jan 03 2021 13:47:28    1609678048377
const dayStart = startOfDay(now); // Sun Jan 03 2021 00:00:00    1609628400000
const nextDayStart = addDays(dayStart, 1); // Mon Jan 04 2021 00:00:00    1609714800000
NumberRange.closedOpen(dayStart, nextDayStart); // [1609628400000..1609714800000)
```

Depending on your domain decisions you might serialize it like this:

```typescript
const range = NumberRange.closedOpen(1609628400000, 1609714800000);

return {
  startDate: format(range.lowerEndpoint, "yyyy-MM-dd"), // Note the unicode tokens used by format in dateFns v2 (https://github.com/date-fns/date-fns/blob/master/docs/unicodeTokens.md)
  toDate: format(range.upperEndpoint, "yyyy-MM-dd"),
};
```

### RangeSet

Not currently implemented. This would be a set containing Ranges, where none of the ranges overlap and overlapping ranges are automatically joined.

A quick way to get this functionality is to create a RangeMap<boolean> or something similar and use putCoalescing.

See also: https://guava.dev/releases/19.0/api/docs/com/google/common/collect/RangeSet.html

### RangeMap

RangeMaps can be used to define a value for a specified Range.

Below you can find an example implementation that pivots a list of attendees with the days that they attend to a list of attendees per day.
The example is a bit convoluted, in this case you would more likely use a simple array, where index keeps track of the day, or a map with a key doing the same.
However, the approach shown here with RangeMap also works for tracking attendance using periods defined by Date objects instead, without much change in code.

```typescript
import { isEqual } from "lodash-es";

// Example input domain object
class Attendance {
  name: string;
  days: number[];
}

// The festival spans 4 days, from day 1 until day 4. Or [1..5)
// IsEqual is uesed to handle array equality for putCoalescing
const festivalAttendanceRangeMap = new RangeMap<string[]>(isEqual);
const attendance: Attendance[] = [
  {
    name: "Bob",
    days: [1, 2, 3, 4],
  },
  {
    name: "Lisa",
    days: [1, 2, 3],
  },
  {
    name: "Eve",
    days: [4, 1],
  },
];

// Init with empty array
festivalAttendanceRangeMap.putCoalescing(Range.closedOpen(1, 5), []);

// Iterate over each attendance
attendance.forEach(({ name, days }) => {
  days.forEach((day) => {
    const dayRange = NumberRange.closedOpen(day, day + 1);
    const subRangeMap = festivalAttendanceRangeMap
      .subRangeMap(dayRange)
      .asMapOfRanges();

    // Iterate over all existing entries for the given day
    // Not really necessary in this example, but this will handle any periods that do not span the entire day as well
    [...subRangeMap.entries()].forEach(([key, value]) => {
      festivalAttendanceRangeMap.putCoalescing(key, [...value, name]);
    });
  });
});

const result = festivalAttendanceRangeMap.asMapOfRanges();

expect([...result.entries()]).toEqual([
  [NumberRange.closedOpen(1, 2), ["Bob", "Lisa", "Eve"]],
  [NumberRange.closedOpen(2, 4), ["Bob", "Lisa"]],
  [NumberRange.closedOpen(4, 5), ["Bob", "Eve"]],
]);
```

See also: https://guava.dev/releases/19.0/api/docs/com/google/common/collect/TreeRangeMap.html

Note that the current implementation in this library is a simple array based list of key/value pairs, not a tree based structure.
