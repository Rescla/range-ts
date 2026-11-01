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
 * p is dimensionless: it does not care whether the machine is fast or slow,
 * whether the timer is nanoseconds or milliseconds, or whether the box is
 * shared with three other jobs. A linear operation reads p ~= 1.0 on a
 * Xeon and on a laptop. A quadratic one reads p ~= 2.0 everywhere. That is
 * the property worth asserting.
 *
 * Absolute times ARE recorded, but only against a deliberately loose
 * tolerance, to catch "still linear, just 10x slower for some reason" that
 * an exponent check alone would miss.
 *
 * Inputs are generated from a seeded PRNG (see `rng()`), so two runs on the
 * same machine see the same data and are comparable. Math.random() would make
 * every run a different workload and the numbers meaningless side by side.
 */

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

/** Median of an array of numbers. */
export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
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

/**
 * Run `fn` `rounds` times after a warmup, return the median wall time in ms.
 *
 * Warmup matters more than it looks: V8 needs several iterations before it
 * stops deoptimising, and a cold first run can be 5-10x a warm one. Taking
 * the median of an odd count kills the outlier tails.
 */
export function time(fn, { rounds = 5, warmup = 1 } = {}) {
  for (let i = 0; i < warmup; i++) fn();
  const samples = [];
  for (let i = 0; i < rounds; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  return lowQuantile(samples, 0.25);
}

/**
 * Time an operation against freshly built state.
 *
 * `make(n)` builds the subject; `op(subject)` is the work being measured.
 * `make` runs before EVERY round and is never inside the timer, so a
 * mutating `op` always sees a pristine map and rounds stay comparable.
 *
 * This is the shape the scenarios use. The earlier `runAt(n)` shape timed the
 * build along with the operation, which made every scenario report the build's
 * exponent and hid the thing being measured.
 */
/**
 * `warmup` must be large enough to reach V8's top optimisation tier, not just
 * "a couple of runs to be polite". Measured on the remove-many scenario at
 * n=20000, 25 consecutive rounds gave:
 *
 *   rounds  0- 9:  47 - 342 ms   (still tiering up; wildly unstable)
 *   rounds 10-24:  21 -  24 ms   (stable)
 *
 * A 7-14x gap between warm and cold for identical work. With the previous
 * `warmup: 1, rounds: 5` every sample was taken from the unstable band, which
 * is how this file reported O(n^2.92) for code that measures O(n^1.1) once
 * optimised. An exponent gate driven by JIT tier is not a gate at all.
 *
 * Warmup runs the SAME subject factory at the SAME size, so the function under
 * test is compiled in the same shape it will be measured in.
 */
export function timeOp(make, op, { rounds = 7, warmup = 14 } = {}) {
  const runOnce = () => {
    const subject = make();
    const t0 = process.hrtime.bigint();
    op(subject);
    return Number(process.hrtime.bigint() - t0) / 1e6;
  };
  for (let i = 0; i < warmup; i++) runOnce();
  const samples = [];
  for (let i = 0; i < rounds; i++) samples.push(runOnce());
  return lowQuantile(samples, 0.25);
}

/**
 * Measure how an operation scales: run it at n and at 2n, return the exponent.
 *
 * `make(n)` returns the subject factory for that size; `op` is timed alone.
 *
 * p ~= 1.0  linear
 * p ~= 1.1  n log n
 * p ~= 2.0  quadratic  <-- the thing we are hunting
 */
export function scaling(make, op, smallN, largeN = smallN * 2, opts) {
  const smallMs = timeOp(() => make(smallN), (s) => op(s, smallN), opts);
  const largeMs = timeOp(() => make(largeN), (s) => op(s, largeN), opts);
  const ratio = largeMs / smallMs;
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

  /** Print an aligned table and return the list of failures. */
  render(baseline) {
    const failures = [];
    const w = Math.max(28, ...this.rows.map((r) => r.name.length));
    console.log(
      "measurement".padEnd(w) +
        "n".padStart(12) +
        "ms".padStart(10) +
        "  exponent".padStart(11) +
        "  max".padStart(7) +
        "  vs baseline".padStart(14) +
        "  verdict"
    );
    console.log("-".repeat(w + 62));

    for (const r of this.rows) {
      const base = baseline?.[r.name];
      const drift = base ? r.scaling.smallMs / base.smallMs : null;
      const expBad = r.scaling.exponent > r.maxExponent;
      const driftBad = r.maxRatioVsBaseline && drift && drift > r.maxRatioVsBaseline;
      const verdict = expBad
        ? `FAIL scaling O(n^${r.scaling.exponent.toFixed(2)}) > O(n^${r.maxExponent})`
        : driftBad
          ? `FAIL drift ${drift.toFixed(1)}x > ${r.maxRatioVsBaseline}x`
          : "ok";
      if (expBad || driftBad) failures.push(r);

      console.log(
        r.name.padEnd(w) +
          `${r.scaling.smallN}/${r.scaling.largeN}`.padStart(12) +
          r.scaling.smallMs.toFixed(1).padStart(10) +
          `O(n^${r.scaling.exponent.toFixed(2)})`.padStart(11) +
          r.maxExponent.toFixed(2).padStart(7) +
          (drift ? `${drift.toFixed(2)}x` : "-").padStart(14) +
          "  " +
          verdict
      );
    }
    return failures;
  }
}
