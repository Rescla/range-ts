# RangeTs

![CI](https://github.com/Rescla/range-ts/workflows/CI/badge.svg)
[![npm version](https://badge.fury.io/js/range-ts.svg)](https://badge.fury.io/js/range-ts)

Typescript ranges based on Guava RangeMap.

> **1.0.0 is an agentic release.** 0.1.8 was the last release written entirely by
> a human. See [About this release — AI disclosure](#about-this-release--ai-disclosure)
> for what that means and how to check it yourself.

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
// Example with DateFns (CET)
const now = new Date(); // Sun Jan 03 2021 13:47:28    1609678048377
const dayStart = startOfDay(now); // Sun Jan 03 2021 00:00:00    1609628400000
const nextDayStart = addDays(dayStart, 1); // Mon Jan 04 2021 00:00:00    1609714800000
NumberRange.closedOpen(dayStart, nextDayStart); // [2021-01-02T23:00:00.000Z..2021-01-03T23:00:00.000Z)
```

Depending on your domain decisions you might serialize it like this:

```typescript
const range = NumberRange.closedOpen(1609628400000, 1609714800000);

return {
  startDate: format(range.lowerEndpoint, "yyyy-MM-dd"), // Note the unicode tokens used by format in dateFns v2 (https://github.com/date-fns/date-fns/blob/master/docs/unicodeTokens.md)
  toDate: format(range.upperEndpoint, "yyyy-MM-dd"),
};
```

### Empty and inverted ranges

`isEmpty()` is true for `[v..v)`, `(v..v]` and `(v..v)` — the ranges whose
endpoints meet with at least one side open. A range whose lower endpoint is
_greater_ than its upper endpoint is not a range, and constructing one throws:

```typescript
NumberRange.closed(5, 1); // Error: lower endpoint (5) is greater than upper endpoint (1)
NumberRange.closedOpen(0.5, -0.5); // Error, same reason
```

The reason is not tidiness. Such a range contains nothing, but it is not
`isEmpty()` — its endpoints never met — so it slips past every guard built on
`isEmpty()`, including the ones inside `RangeMap` that keep a map's `span()`
honest. Before it was rejected, `map.put(closedOpen(0.5, -0.5), 'x')` gave a map
that reported a span of `[0.5..-0.5)` and one visible entry while associating a
value with nothing. Put the endpoints the right way round, or use an empty range
such as `closedOpen(v, v)` if you mean "nothing".

`NaN` endpoints are a different case and do not throw: an unordered comparison is
a non-answer, not an inversion, and it propagates as `false` from `contains`,
`encloses` and friends rather than becoming a construction error.

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
import { RangeMap, NumberRange } from "range-ts";

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
festivalAttendanceRangeMap.putCoalescing(NumberRange.closedOpen(1, 5), []);

// Iterate over each attendance
attendance.forEach(({ name, days }) => {
  days.forEach((day) => {
    const dayRange = NumberRange.closedOpen(day, day + 1);
    const subRangeMap = festivalAttendanceRangeMap.subRangeMap(dayRange).asMapOfRanges();

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

#### Differences from Guava's `TreeRangeMap`

This library follows Guava's semantics closely but is not a line-for-line port. Five
places behave differently, and all of them are deliberate:

|                                    | Guava                                                                        | range-ts                                                                                                                                                                                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Range as a `Map` key**           | `Range` has `equals`/`hashCode`, so `asMapOfRanges().get(equalRange)` works  | `Range` has **no value equality**. JS `Map` uses SameValueZero with no hook to override, so the key is object identity and `get(equalRange)` is `undefined`. Look up by **point** instead: `get(k)` / `getEntry(k)`.                                                        |
| **`put(range, null)`**             | throws (`checkNotNull`)                                                      | accepted. `get` already returns `null` for absent, so this matches JS `Map`. Use `getEntry(k)` to tell "mapped to null" from "no entry".                                                                                                                                    |
| **`putCoalescing` merge width**    | computes both neighbour probes against the **unmutated** map                 | the second probe sees the array the first already spliced, so it can merge **more**. Same point mapping always; no differently-valued entry can be clobbered. Treat `asMapOfRanges()` after a coalescing write as the current partition, not a record of what you inserted. |
| **Empty range in `putCoalescing`** | bridges: `putCoalescing([1..1), a)` on `{[0..1)=a, [1..2)=a}` → `{[0..2)=a}` | **same** — the bridge works. Plain `put` of an empty range is a no-op in both.                                                                                                                                                                                              |
| **`subRangeMap`**                  | a live view; writes go to the parent                                         | an **independent snapshot**. `sub.put(...)` does not touch the parent. Values are still shared by reference, so mutating a value read through the submap does reach the parent.                                                                                             |

The first two are consequences of the platform rather than choices — there is no way
to give a JS `Map` custom key equality. The last three are design decisions made
for a sorted-array backing store.

## Scalars: ranges over exact domains

By default endpoints are compared with `valueOf()`, which is the JavaScript `number`
double. That is fine for ordinary values, but a double cannot represent integers
above `2^53` exactly — past that point `x + 1 === x`, so two genuinely distinct
ids compare as equal.

A `Scalar<T>` describes how to compare, increment and bound a domain, so ranges can
be built over types that are not JS numbers. `bigintScalar` is shipped for exact
integer domains:

```typescript
import { defineRange, bigintScalar, RangeMap, BigIntPoint } from "range-ts";

// A factory bound to one scalar, so you do not pass it at every construction site.
const R = defineRange(bigintScalar);

// Discord snowflakes are 64-bit ids. As a JS number this is silently wrong:
//   Number('747982103920246824') === 747982103920246800
const map = new RangeMap<string, BigIntPoint>();
map.put(R.closedOpen(BigInt("747982103920246824"), BigInt("747982103920246826")), "exact");

map.get(BigInt("747982103920246825")); // "exact"  — distinguishable
map.get(BigInt("747982103920246827")); // null
```

`bigint` has no infinity of its own, so the unbounded sides are sentinel values and
the point type is the union `BigIntPoint = bigint | typeof BIGINT_PLUS_INFINITY |
typeof BIGINT_MINUS_INFINITY`. That is why a map over this domain is typed
`RangeMap<string, BigIntPoint>` rather than `RangeMap<string, bigint>`.

`numberScalar` and `comparableScalar` are also exported for the default behaviour,
and you can define your own `Scalar<T>` for any domain — see `scalar-range.spec.ts`
for a worked consumer-side example.

## Module resolution

The package ships CommonJS and ESM builds and resolves through an `exports` map:

| Consumer                     | Gets                    |
| ---------------------------- | ----------------------- |
| `require("range-ts")`        | `dist/cjs` (CommonJS)   |
| `import ... from "range-ts"` | `dist/esm` (ES modules) |
| TypeScript                   | `dist/types`            |

`range-ts/package.json` is also exported, for tooling that reads the version.

**Deep imports are not supported.** `require("range-ts/dist/cjs/index.js")` and
similar paths fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Everything public is
reachable from the package root, so there is no reason to reach into `dist/`; the
restriction exists so internals can be reorganised without it becoming a breaking
change. Import from `"range-ts"`.

The ESM build is genuine ES modules with explicit file extensions and a
`{"type":"module"}` marker, so it loads in Node directly and tree-shakes in
bundlers.

## About this release — AI disclosure

**0.1.8 (published 2025-02-20) was the last human-authored release.** The
library from its initial commit through 0.1.8 was written by Marc Fokkert across
2021–2025.

**1.0.0 was produced agentically**: written by an AI coding agent ([pi](https://pi.dev))
working to a human maintainer's direction. This section exists so you can weigh
that rather than find out later.

**What the agent did.** The TypeScript 5 → 7 migration and the ES5 drop it
forced; the generic `Scalar<T>` refactor and the exact-domain (`bigint`) work;
the packaging changes (exports map, module-type markers, making `dist/esm`
loadable by Node's ESM loader); the test-infrastructure rebuild (three
environments, Stryker mutation testing); the CI and release-workflow rework; and
most of the prose in `CHANGELOG.md` and `RELEASE.md`.

**What the human did.** Set the scope and decided which breaking changes were
acceptable; reviewed the agent's output, including a second independent review
pass run against the _packed tarball_ rather than the source tree; and owns the
release decision itself. The publish/promote step is deliberately outside the
agent's reach — CI ends at "staged", and promotion requires a human with 2FA.

**What this is not.** It is not a claim that the code is correct. It is a claim
that it is instrumented and was reviewed: a spec suite that runs across Node,
jsdom and Chrome, and a mutation score that measures how much of the logic those
specs actually catch. Both are reproducible from this repository without trusting
anyone — run `npm test` and `npm run test:mutation`. This page deliberately
quotes neither figure: a count written into prose is stale the first time a test
is added, and a stale number in the one paragraph whose job is "check us" is
worse than no number. The per-release numbers live in `CHANGELOG.md`, where they
are a dated record rather than a claim about the present.

**A note on attribution.** The agent's commits carry the maintainer's git
identity, so `git log` does **not** distinguish them. The boundary is a date, not
a count: everything up to and including 2025-02-20 (0.1.8) is human-authored,
and the work after that is the agentic work that became 1.0.0. Derive the set
rather than trusting a number written down here:

```bash
git log --since=2025-02-21 --oneline   # the agentic commits
git log --until=2025-02-20 --oneline   # the human-authored history
```

If you need to attribute a line of this release to a machine rather than a
person, that is the boundary.

**Why disclose.** Not because a licence requires it and not as a disclaimer.
An AI-written range library in someone's dependency tree is a fact they would
want, and it is the kind of fact that is easy to omit by accident and harder to
recover later. It also sets the expectation that the review burden shifts: less
"the author wrote this, it's probably fine", more "here is instrumentation, check
it".
