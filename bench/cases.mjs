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
 *  - Random insert pays a memmove per put: O(n) per put, O(n^2) to build.
 *    The native memmove is ~50x cheaper per element than the JS-level scan
 *    it replaced, so the constant is small — but the CLASS is still
 *    quadratic, and that is why these rows are gated at 2.05 now.
 *
 *    RETRACTED: the previous text gated this at 1.75 as "tight enough that
 *    the old scan-and-rebuild (measured 1.96-2.01) fails hard". It fired
 *    on unchanged code on the CI runner, which read 1.77. The exponent on
 *    this workload is a blend of CPU-bound JS work and memory-bandwidth-bound
 *    memmove, and the blend weight moves with the machine: ~1.45 on the dev
 *    box, 1.77 on the runner, against a 0.25 margin. And more fundamentally,
 *    an exponent cannot separate "quadratic with a tiny constant (fine)"
 *    from "quadratic with a big constant (not fine)" — that is a
 *    constant-factor question and this instrument cannot answer it.
 *
 *    So: the ceiling catches worse-than-quadratic; normalised drift catches
 *    the scan-and-rebuild, which is ~15x in absolute terms and reads ~15n
 *    against a read-derived runner factor.
 *  - Lookups are binary searches: p ~ 1.0, gated at 1.25. Single-class, so
 *    the exponent really is machine-independent here (1.02 dev box, 1.09 CI).
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
      // Class ceiling, not a tight gate — see the retraction in the header.
      maxExponent: 2.05,
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
      // Class ceiling, not a tight gate. This is the row that failed CI at
      // 1.77 against the old 1.75 gate; the true class is quadratic and the
      // measured exponent is machine-dependent. Constant-factor regressions
      // on this path are caught by normalised drift, not here.
      maxExponent: 2.05,
      make: () => new RangeMap(),
      op: (m, n) => {
        for (const r of inputs(NumberRange, n).randomB) m.put(r, 1);
      },
    },
    {
      name: "get hit",
      maxExponent: 1.25,
      // Pure read: no write-path change can slow it, which is what makes it
      // usable as a runner-factor reference (see Report.render).
      reference: true,
      make: mkSeq,
      op: (m, n) => {
        let acc = 0;
        for (let i = 0; i < n; i++) if (m.get(i * STRIDE + 1) !== null) acc++;
        if (acc === 0)
          throw new Error("get-hit scenario found no hits — measuring the wrong thing");
        return acc;
      },
    },
    {
      name: "get miss (in the gaps)",
      maxExponent: 1.25,
      reference: true,
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
      // This workload is allocation-dominated and the exponent is NOT
      // resolvable to better than roughly +/-1.5 on a shared box. Measured on
      // this build, current runner config (rounds=7, warmup=14), n=20000 ->
      // 40000:
      //
      //   this case ALONE, 12 runs      -> min 0.57, med 0.85, max 2.01
      //   inside the FULL suite, 19 runs -> spread -0.19 .. 3.53
      //
      // The full-suite spread is the one that matters, because that is how the
      // gate runs: eleven other scenarios ahead of it move the heap and the
      // thermal state. At a 2.5 gate that spread failed 2 of 19 runs on
      // unchanged code (~10%), which is exactly the failure mode this file's
      // own notes warn about: a gate that fires at random trains people to
      // ignore red. An earlier note here claimed this case read "1.75 / 1.76 /
      // 1.77 (tight)"; that is a three-sample coincidence, not reproducible,
      // and it was cited to justify a gate the measurements do not support.
      //
      // Gate is 4.0: above the whole observed spread, so it passes reliably,
      // and it still catches a gross regression. State the limit plainly —
      // this row guards against super-quadratic-by-2x, NOT against a genuine
      // cubic regression, which would land inside the noise.
      //
      // Which means the EXPONENT ROW IS NOT THE GUARD HERE — it is a tripwire
      // for gross breakage only. The guard that actually bites is the baseline
      // absolute-time ratio, so it is set explicitly tight on this row rather
      // than inheriting the 3.0 default: paired runs read 0.99x-1.01x against
      // the baseline, so 2.0 keeps ~2x headroom over run-to-run variation
      // while still catching "still linear, twice as slow" — the regression
      // class an exponent gate structurally cannot see. This is only
      // trustworthy because run.mjs now refuses to compare against a baseline
      // recorded at a different n; before that check, "primary guard" was
      // doing its arithmetic across two problem sizes and meant nothing.
      name: "remove (many small interior cuts)",
      maxExponent: 4.0,
      maxRatioVsBaseline: 2.0,
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
          m.remove(NumberRange.closedOpen(k * chunk * STRIDE, (k + 1) * chunk * STRIDE));
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
          acc += m
            .subRangeMap(NumberRange.closedOpen(i * STRIDE, i * STRIDE + 1))
            .asMapOfRanges().size;
        }
        if (acc === 0)
          throw new Error("small-window subRangeMap found nothing — measuring the wrong thing");
        return acc;
      },
    },
    {
      name: "asMapOfRanges (full materialise)",
      maxExponent: 1.35,
      reference: true,
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
      reference: true,
      make: mkSeq,
      op: (m, n) => {
        for (let i = 0; i < n; i++) m.span();
      },
    },
  ];
}
