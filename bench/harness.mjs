/**
 * Benchmark harness for RangeMap scaling.
 *
 * WHY THIS IS A SEPARATE SUITE. These are not unit tests. They are slow, they
 * are timing-based, and a single slow CI box must not turn a correct build red
 * — but a quadratic regression in the write path MUST be caught, because it is
 * invisible to correctness tests and took this library from milliseconds to
 * fifteen seconds without a single failing assertion.
 *
 * So the gate is the SCALING EXPONENT, not the absolute time.
 *
 *   time(2n) / time(n) = 2^p     =>  p = log2(ratio)
 *
 * p is dimensionless, and for a SINGLE-COMPLEXITY-CLASS workload that means
 * what it looks like it means: a pure binary search reads p ~= 1.0 on a Xeon
 * and on a laptop (measured across machines here: get hit 1.02 and 1.09).
 * A quadratic one reads p ~= 2.0 everywhere. That is the property worth
 * asserting, and for those rows it holds.
 *
 * IT IS NOT MACHINE-INDEPENDENT FOR A MIXED WORKLOAD, and that is not a
 * nitpick -- it is what broke the first CI run. A case that interleaves a
 * native memmove (memory-bandwidth-bound) with JS-level work (CPU-bound)
 * measures a BLEND of the two classes, and the blend weight depends on the
 * machine's memory-to-CPU cost ratio. `put (random order)` reads ~1.45 on
 * the dev box and 1.77 on the GitHub runner against a gate of 1.75. Worse,
 * a random-order build is *genuinely* quadratic -- each insert shifts ~n/2
 * entries -- so no exponent can separate "quadratic with a tiny constant
 * (fine)" from "quadratic with a big constant (not fine)". That is a
 * constant-factor question and the exponent is structurally the wrong
 * instrument for it. Rows like that are gated at their theoretical class
 * ceiling and the constant is guarded by normalised drift instead.
 *
 * Absolute times ARE recorded, but as a ratio normalised against a runner
 * factor (see `Report.render`) so that a slower machine cancels out instead
 * of failing the build. The header of this file used to claim a slow CI box
 * could not turn a correct build red; the first CI run on this tree proved
 * that wrong, and the runner factor is the fix.
 *
 * Inputs are generated from a seeded PRNG (see `rng()`), so two runs on the
 * same machine see the same data and are comparable. Math.random() would make
 * every run a different workload and the numbers meaningless side by side.
 */

/**
 * How many reference-row drifts are needed before a runner factor is
 * trusted. Four keeps the median from riding on any single row while still
 * being reachable; below it the drift gate reports itself unavailable
 * rather than falling back to a number that would gate the hardware.
 */
export const MIN_REFERENCE_DRIFTS = 4;

/** Deterministic PRNG (mulberry32). Same seed => same sequence, every run. */
export function rng(seed = 0x5eed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Low-quantile estimator — the statistic this harness times with.
 *
 * Median is the wrong choice for wall-clock benchmarks on a shared machine.
 * Every external interference (scheduler, GC, a neighbour process, thermal
 * throttling) pushes a sample SLOWER and never faster, so the median absorbs
 * that interference as if it were signal. Measured on a pure-read case with
 * no allocation at all, over 25 rounds:
 *
 *   n=20000  min 2.65  med 2.84  max 7.08   (2.68x spread)
 *   n=40000  min 4.45  med 5.92  max 7.91   (1.78x spread)
 *
 * Exponent from min: 0.75. From median: 1.06. The median version failed a
 * 1.25 gate on some runs purely because seven samples caught a bad patch.
 *
 * The low quantile is the fastest honest run, which is the one that reflects
 * the code rather than the machine. p25 rather than strict min so a single
 * anomalously cheap sample (a short-circuit, a lucky cache) cannot set the
 * number the way interference sets the median.
 */
export function lowQuantile(xs, q = 0.25) {
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor(q * s.length));
  return s[idx];
}

/*
 * TWO RULES THIS HARNESS EXISTS TO ENFORCE (kept here as evidence, not code —
 * `scaling` below implements both, and a second copy of them as a helper
 * function is how they got bypassed last time):
 *
 * 1. SETUP IS NEVER INSIDE THE TIMER. `make(n)` builds the subject before
 *    every round and outside the timed region, so a mutating `op` always sees
 *    a pristine map and rounds stay comparable. The earlier `runAt(n)` shape
 *    timed the build along with the operation, which made every scenario
 *    report the build's exponent and hid the thing being measured.
 *
 * 2. WARMUP MUST REACH V8'S TOP TIER, not just "a couple of runs to be
 *    polite". Measured on the remove-many scenario at n=20000, 25
 *    consecutive rounds gave:
 *
 *      rounds  0- 9:  47 - 342 ms   (still tiering up; wildly unstable)
 *      rounds 10-24:  21 -  24 ms   (stable)
 *
 *    A 7-14x gap between warm and cold for identical work. With
 *    `warmup: 1, rounds: 5` every sample came from the unstable band, which
 *    is how this file reported O(n^2.92) for code that measures O(n^1.1)
 *    once optimised. An exponent gate driven by JIT tier is not a gate at
 *    all. Warmup runs the SAME factory at the SAME size, so the function is
 *    compiled in the shape it will be measured in.
 */

/**
 * Measure how an operation scales: run it at n and at 2n, return the exponent.
 *
 * `make(n)` returns the subject factory for that size; `op` is timed alone.
 *
 * p ~= 1.0  linear
 * p ~= 1.1  n log n
 * p ~= 2.0  quadratic  <-- the thing we are hunting
 *
 * WHY THE PAIRS ARE INTERLEAVED. The obvious shape — time every small round,
 * then time every large round, then divide the two quantiles — compounds noise
 * instead of cancelling it: a slow patch during the large phase and a fast
 * patch during the small phase multiply into the ratio. That is what made the
 * gate fire at random even after warmup was fixed; the same unchanged code
 * read O(n^1.48), O(n^1.96) and O(n^2.25) on three consecutive runs.
 *
 * Timing the two sizes as a PAIR, back to back, means anything external that
 * hits one hits both, and the ratio is taken WITHIN the pair before any
 * averaging. The order is alternated per round so a systematic "second one
 * is slower" effect (cache, GC timing) cancels across the round set instead
 * of biasing every pair the same way. The exponent then comes from the p25 of
 * the paired ratios, not from a ratio of two independently chosen samples.
 */
export function scaling(make, op, smallN, largeN = smallN * 2, opts) {
  const { rounds = 7, warmup = 14 } = opts || {};

  const runOnce = (n) => {
    const subject = make(n);
    const t0 = process.hrtime.bigint();
    op(subject, n);
    return Number(process.hrtime.bigint() - t0) / 1e6;
  };

  // Warm both sizes to the same tier before either is measured, so neither
  // phase pays for the other's compilation.
  for (let i = 0; i < warmup; i++) {
    runOnce(smallN);
    runOnce(largeN);
  }

  const small = [];
  const large = [];
  const ratios = [];
  for (let i = 0; i < rounds; i++) {
    const a = runOnce(i % 2 === 0 ? smallN : largeN);
    const b = runOnce(i % 2 === 0 ? largeN : smallN);
    const s = i % 2 === 0 ? a : b;
    const l = i % 2 === 0 ? b : a;
    small.push(s);
    large.push(l);
    ratios.push(l / s);
  }

  const smallMs = lowQuantile(small, 0.25);
  const largeMs = lowQuantile(large, 0.25);
  const ratio = lowQuantile(ratios, 0.25);
  const exponent = Math.log(ratio) / Math.log(largeN / smallN);
  return { smallN, largeN, smallMs, largeMs, ratio, exponent };
}

/**
 * A named measurement with its verdict thresholds.
 *
 * maxExponent  — hard gate. Above this the scaling is worse than declared and
 *                the run fails. Set with headroom above the theoretical value
 *                so that measurement noise does not cause false failures, but
 *                well below the next bad complexity class.
 * maxRatioVsBaseline — loose gate on absolute time, for drift.
 */
export class Report {
  constructor() {
    this.rows = [];
  }

  add(row) {
    this.rows.push(row);
    return row;
  }

  /**
   * Print an aligned table and return the list of failures.
   *
   * THE RUNNER FACTOR, and why the drift gate needs one.
   *
   * A baseline recorded on one machine compared against a run on another is
   * not a regression measurement. The first CI run of the current tree came
   * in at 1.27x - 2.02x on EVERY row, median ~1.51x, with no change that
   * could slow reads and writes alike: that is the GitHub runner being
   * slower than the dev box that recorded the baseline. Gating on the raw
   * ratio gates the hardware, not the code.
   *
   * So each row's drift is divided by a RUNNER FACTOR: the median drift of
   * the rows marked `reference` -- pure reads, which no write-path change
   * can slow. A uniformly slower runner cancels out; a per-case regression
   * still stands out. On that same CI run the reference median was 1.34x,
   * which puts every write row between 0.94n and 1.51n, while a genuine 2x
   * write-path regression would still read ~2.0n.
   *
   * The reference set is the load-bearing part. Taking the median over ALL
   * rows would let a change that slows the whole write path drag the factor
   * up with it and normalise itself away. Reads are the fixed point exactly
   * because the thing under test cannot touch them.
   *
   * With too few reference drifts to form an honest factor the drift gate is
   * reported UNAVAILABLE rather than silently falling back to the raw
   * machine-dependent ratio. A gate that quietly changes what it measures is
   * worse than no gate.
   */
  render(baseline) {
    const failures = [];
    const baseN = baseline?.smallN ?? null;
    const w = Math.max(28, ...this.rows.map((r) => r.name.length));

    // Pass 1: raw drift per row. Normalisation happens against the whole
    // table, so it cannot be done row-by-row.
    const measured = this.rows.map((r) => {
      // The baseline file nests the rows under `measurements` (see run.mjs's
      // --update-baseline writer). Reading them off the top level returned
      // undefined for every row, so `drift` was always null, the
      // "vs baseline" column printed "-" everywhere, and
      // maxRatioVsBaseline could never fire: the gate that this file claims
      // catches "still linear, just 10x slower" was inert. Accept both
      // shapes so a hand-written flat baseline still works.
      const base = baseline?.measurements?.[r.name] ?? baseline?.[r.name];
      // A drift ratio across two different problem sizes measures the size
      // difference, not a regression: at n=40000 against a 20000 baseline
      // every row read ~2x, which is the expected cost of twice the work.
      // run.mjs refuses this combination in check mode; the guard is here too
      // so a direct caller cannot get a confident-looking wrong number.
      const sizeMismatch = baseN !== null && r.scaling.smallN !== baseN;
      const drift = !sizeMismatch && base ? r.scaling.smallMs / base.smallMs : null;
      return { r, drift, sizeMismatch };
    });

    const refDrifts = measured
      .filter((m) => m.r.reference && Number.isFinite(m.drift))
      .map((m) => m.drift);
    const runnerFactor =
      refDrifts.length >= MIN_REFERENCE_DRIFTS ? lowQuantile(refDrifts, 0.5) : null;

    console.log(
      "measurement".padEnd(w) +
        "n".padStart(12) +
        "ms".padStart(10) +
        "  exponent".padStart(11) +
        "  max".padStart(7) +
        "  vs baseline".padStart(16) +
        "  verdict"
    );
    console.log("-".repeat(w + 64));

    for (const { r, drift, sizeMismatch } of measured) {
      const norm = runnerFactor && Number.isFinite(drift) ? drift / runnerFactor : null;
      const expBad = r.scaling.exponent > r.maxExponent;
      const driftBad = runnerFactor !== null && r.maxRatioVsBaseline && norm > r.maxRatioVsBaseline;
      const verdict = expBad
        ? `FAIL scaling O(n^${r.scaling.exponent.toFixed(2)}) > O(n^${r.maxExponent})`
        : driftBad
          ? `FAIL drift ${norm.toFixed(2)}n > ${r.maxRatioVsBaseline}n`
          : "ok";
      if (expBad || driftBad) failures.push(r);

      const msFmt = (v) => (v < 1 ? v.toFixed(3) : v.toFixed(1));
      // `x` = raw ratio against the baseline; `n` = the same ratio with the
      // runner factor divided out. The gate reads the `n` value.
      const driftCell = sizeMismatch
        ? `n/a@${baseN}`
        : !Number.isFinite(drift)
          ? "-"
          : norm === null
            ? `${drift.toFixed(2)}x`
            : `${drift.toFixed(2)}x/${norm.toFixed(2)}n`;

      console.log(
        r.name.padEnd(w) +
          `${r.scaling.smallN}/${r.scaling.largeN}`.padStart(12) +
          msFmt(r.scaling.smallMs).padStart(10) +
          `O(n^${r.scaling.exponent.toFixed(2)})`.padStart(11) +
          r.maxExponent.toFixed(2).padStart(7) +
          driftCell.padStart(16) +
          "  " +
          verdict
      );
    }

    if (runnerFactor !== null) {
      console.log(
        `\nrunner factor: ${runnerFactor.toFixed(2)}x ` +
          `(median drift of ${refDrifts.length} reference rows; the gate reads the /Nn column)`
      );
    } else {
      console.log(
        `\ndrift gate UNAVAILABLE: ${refDrifts.length} reference row(s) had a baseline, ` +
          `${MIN_REFERENCE_DRIFTS} needed to form a runner factor.\n` +
          `  Raw ratios are printed but NOT gated -- they are machine-dependent. `
      );
    }
    return failures;
  }
}
