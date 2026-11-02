/**
 * Benchmark scenarios for RangeMap.
 *
 * Each scenario is `{ name, maxExponent, make(n), op(subject, n) }`.
 * `make` builds the subject and is never timed; `op` is the measured work.
 * See harness.timeOp for why that separation is the whole point.
 *
 * Scenarios deliberately separate the operations that were O(n) per call in
 * the shipped 1.0.0 write path. A single blended benchmark would average one
 * quadratic operation into invisibility, and "the suite got slower" is not
 * actionable — "put build is O(n^2)" is.
 *
 * The disjoint-entry maps use a stride of 10 and a width of 8 so there are
 * gaps between entries. A contiguous map coalesces into a single entry and
 * stops exercising the structure at all.
 */
import { rng } from "./harness.mjs";

const STRIDE = 10;
const WIDTH = 8;

function shuffled(arr, seed) {
  const rand = rng(seed);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Pre-built input lists, memoised by size.
 *
 * Memoised because generating them inside the timed region would measure the
 * generator instead of the operation — the exact mistake this harness exists
 * to avoid. Keyed by n so the two sizes in a scaling run never alias.
 */
const inputsCache = new Map();
function inputs(NumberRange, n) {
  const hit = inputsCache.get(n);
  if (hit) return hit;
  const ranges = [];
  for (let i = 0; i < n; i++) {
    ranges.push(NumberRange.closedOpen(i * STRIDE, i * STRIDE + WIDTH));
  }
  const made = {
    ascending: ranges,
    randomA: shuffled(ranges, 7),
    randomB: shuffled(ranges, 11),
  };
  inputsCache.set(n, made);
  return made;
}

/**
 * `maxExponent` is the gate, set with headroom above the theoretical value so
 * measurement noise cannot cause a false failure, but well below the next bad
 * complexity class so a real regression cannot hide.
 *
 *  - Sequential append onto a sorted array splices at the end, which is O(1),
 *    so the build is O(n log n) overall -> p ~ 1.1, gated at 1.35.
 *  - Random insert pays a memmove per put. That is O(n) per put and O(n^2)
 *    in the limit, but the memmove is native and roughly 50x cheaper per
 *    element than the JS-level scan it replaces; measured ~1.4. Gated at
 *    1.75 — honest about what this structure is, tight enough that the old
 *    scan-and-rebuild (measured 1.96-2.01) fails hard.
 *  - Lookups are binary searches: p ~ 1.0, gated at 1.25.
 */
export function scenarios(mod) {
  const { RangeMap, NumberRange } = mod;

  const mkSeq = (n) => {
    const m = new RangeMap();
    for (const r of inputs(NumberRange, n).ascending) m.put(r, 1);
    return m;
  };

  return [
    {
      name: "putCoalescing (append, sequential)",
      maxExponent: 1.35,
      make: () => new RangeMap(),
      op: (m, n) => {
        for (const r of inputs(NumberRange, n).ascending) m.putCoalescing(r, 1);
      },
    },
    {
      name: "putCoalescing (random order)",
      maxExponent: 1.75,
      make: () => new RangeMap(),
      op: (m, n) => {
        for (const r of inputs(NumberRange, n).randomA) m.putCoalescing(r, 1);
      },
    },
    {
      name: "put (append, sequential)",
      maxExponent: 1.35,
      make: () => new RangeMap(),
      op: (m, n) => {
        for (const r of inputs(NumberRange, n).ascending) m.put(r, 1);
      },
    },
    {
      name: "put (random order)",
      maxExponent: 1.75,
      make: () => new RangeMap(),
      op: (m, n) => {
        for (const r of inputs(NumberRange, n).randomB) m.put(r, 1);
      },
    },
    {
      name: "get hit",
      maxExponent: 1.25,
      make: mkSeq,
      op: (m, n) => {
        let acc = 0;
        for (let i = 0; i < n; i++) if (m.get(i * STRIDE + 1) !== null) acc++;
        if (acc === 0) throw new Error("get-hit scenario found no hits — measuring the wrong thing");
        return acc;
      },
    },
    {
      name: "get miss (in the gaps)",
      maxExponent: 1.25,
      make: mkSeq,
      op: (m, n) => {
        let acc = 0;
        for (let i = 0; i < n; i++) if (m.get(i * STRIDE + WIDTH + 1) !== null) acc++;
        return acc;
      },
    },
    {
      // This one IS quadratic and the gate says so. An interior remove splices
      // in the middle of the backing array, so it memmoves the whole tail:
      // O(n) per call, O(n^2) for n/2 calls. The port buys the CONSTANT, not
      // the exponent — measured 300-500x faster than the old scan-and-rebuild
      // at every size (10k: 1748ms -> 5.9ms; 40k: 30339ms -> 90.9ms).
      //
      // The structure's honest guarantee is: reads are O(log n), writes are
      // O(n) worst case with a native-memmove constant. That is the trade for
      // choosing a sorted array over a tree, and it is the right trade while
      // reads dominate. A write-dominated interior workload is where a
      // different structure would win; see docs/1.0.0-notes.md.
      //
      // MEASUREMENT CAVEAT, so nobody "fixes" this by tightening the gate.
      // This workload is allocation-dominated: each round builds a 20-40k
      // entry map and splits half of it, so the reading is sensitive to heap
      // state. What actually destabilised it was a SHORT warmup, not a long
      // one. Same code, n=20000 -> 40000, three passes each:
      //
      //   warmup=1,  rounds=5  ->  p = 5.03 / 1.78 / 1.80   (one FAIL)
      //   warmup=14, rounds=7  ->  p = 1.75 / 1.76 / 1.77   (tight)
      //
      // An earlier note here claimed the opposite — that MORE warmup made it
      // worse (14 -> 1.44, 30 -> 2.20, 60 -> 4.76). That is not
      // reproducible on this build and it was the justification people would
      // cite to keep warmup low, which is what made the gate flaky. Re-measure
      // before repeating it.
      //
      // Gate stays at 2.5: deliberately loose, catches only a gross regression
      // past quadratic-plus. The real protection for this path is the
      // differential test (3000+ randomised put/putCoalescing/remove
      // sequences against the previous build, 0 data loss) and the other
      // gated cases, not this number.
      name: "remove (many small interior cuts)",
      maxExponent: 2.5,
      make: mkSeq,
      op: (m, n) => {
        for (let i = 0; i < n / 2; i++) {
          m.remove(NumberRange.closedOpen(i * STRIDE + 2, i * STRIDE + 4));
        }
      },
    },
    {
      // A single wide remove is ~20 microseconds at n=40000. An exponent
      // computed from two sub-millisecond medians is pure noise — the first
      // version of this case reported O(n^1.70) for what is O(k) work.
      // Spread the same total removal over 16 disjoint wide chunks so each
      // timed op moves enough bytes to measure, and the total stays O(n).
      name: "remove (wide chunks across the domain)",
      maxExponent: 1.35,
      make: mkSeq,
      op: (m, n) => {
        const chunk = n / 32;
        for (let k = 0; k < 16; k++) {
          m.remove(
            NumberRange.closedOpen(k * chunk * STRIDE, (k + 1) * chunk * STRIDE)
          );
        }
      },
    },
    {
      name: "subRangeMap (half the domain)",
      maxExponent: 1.35,
      make: mkSeq,
      op: (m, n) => m.subRangeMap(NumberRange.closedOpen(0, (n / 2) * STRIDE)),
    },
    {
      // The case the single-call subRangeMap above cannot see. One call over a
      // big map is O(n) whatever the implementation, so its exponent reads
      // ~1.2 and passes no matter how expensive each call is. Many SMALL
      // submaps is the shape that distinguishes "scans the whole map every
      // time" from "bounds the window it actually intersects": the first is
      // O(n) per call and O(n^2) across n/10 calls, the second is
      // O(log n + k) per call with k ~ 1 here. Measured O(n^2.0) before the
      // window was bounded, O(n^1.1) after.
      name: "subRangeMap (many small windows)",
      maxExponent: 1.5,
      make: mkSeq,
      op: (m, n) => {
        let acc = 0;
        for (let i = 0; i < n / 10; i++) {
          acc += m.subRangeMap(NumberRange.closedOpen(i * STRIDE, i * STRIDE + 1)).asMapOfRanges().size;
        }
        if (acc === 0) throw new Error("small-window subRangeMap found nothing — measuring the wrong thing");
        return acc;
      },
    },
    {
      name: "asMapOfRanges (full materialise)",
      maxExponent: 1.35,
      make: mkSeq,
      op: (m, n) => m.asMapOfRanges(),
    },
    {
      // n calls, not one. A single `span()` on the from-the-ends implementation
      // is ~5 us, and an exponent computed from two samples that small is
      // noise — it read O(n^1.45) and failed a 1.35 gate on code that is
      // O(1). Calling it n times makes the case measure what it claims:
      // O(n) total while span is O(1), and O(n^2) the moment span regresses
      // to the whole-array-filter version it replaced.
      name: "span (n calls)",
      maxExponent: 1.35,
      make: mkSeq,
      op: (m, n) => {
        for (let i = 0; i < n; i++) m.span();
      },
    },
  ];
}
