#!/usr/bin/env node
/**
 * Self-test for the GATE, not for the library.
 *
 * WHY THIS EXISTS. The bench gate is the only thing standing between this repo
 * and another fifteen-second write path, and it is also the only check in the
 * project that can be wrong for reasons that have nothing to do with the code:
 * the first CI run failed `put (random order)` at O(n^1.77) against a 1.75
 * gate on perfectly correct code, because the exponent on a mixed
 * JS-work/memmove workload moves with the machine. A gate you cannot test
 * without a slow machine is a gate you cannot fix with confidence.
 *
 * So: feed the gate synthetic numbers whose machine properties are known, and
 * assert what it concludes. No timing, no allocation, deterministic — which
 * means it can run in CI in milliseconds, before the real bench step.
 *
 * Run: npm run bench:selftest
 */

import { Report, MIN_REFERENCE_DRIFTS } from "./harness.mjs";

let checks = 0;
let bad = [];

function expect(label, actual, expected) {
  checks++;
  if (actual !== expected) bad.push(`${label}: got ${actual}, expected ${expected}`);
}

/**
 * Build a baseline + report pair from a table of
 * `{ name, baseMs, nowMs, exponent, maxExponent, reference }`.
 */
function replay(rows, baseN = 20000, nowN = 20000) {
  const measurements = {};
  for (const r of rows) measurements[r.name] = { smallMs: r.baseMs, largeMs: r.baseMs * 2 };

  const report = new Report();
  for (const r of rows) {
    report.add({
      name: r.name,
      scaling: {
        smallMs: r.nowMs,
        largeMs: r.nowMs * 2,
        exponent: r.exponent,
        smallN: nowN,
        largeN: nowN * 2,
      },
      maxExponent: r.maxExponent,
      maxRatioVsBaseline: r.maxRatioVsBaseline ?? 3.0,
      reference: r.reference === true,
    });
  }
  return { baseline: { smallN: baseN, measurements }, report };
}

const READ = (name, baseMs, nowMs) => ({
  name,
  baseMs,
  nowMs,
  exponent: 1.0,
  maxExponent: 1.25,
  reference: true,
});

/**
 * The four pure-read rows, slowed by `f`. Used as the reference block in
 * every scenario below.
 */
const readsSlowed = (f) => [
  READ("get hit", 2.1, 2.1 * f),
  READ("get miss (in the gaps)", 2.1, 2.1 * f),
  READ("asMapOfRanges (full materialise)", 0.8, 0.8 * f),
  READ("span (n calls)", 0.85, 0.85 * f),
];

// ---------------------------------------------------------------------------
// 1. A uniformly slower machine must NOT fail anything.
//
// This is the CI case that started this: every row 1.27x-2.02x slower than a
// baseline recorded on a different box. The runner factor divides that out.
// ---------------------------------------------------------------------------
{
  const rows = [
    ...readsSlowed(1.45),
    {
      name: "put (random order)",
      baseMs: 13.0,
      nowMs: 13.0 * 1.48,
      exponent: 1.77,
      maxExponent: 2.05,
    },
    {
      name: "putCoalescing (append, sequential)",
      baseMs: 7.1,
      nowMs: 7.1 * 1.65,
      exponent: 1.06,
      maxExponent: 1.35,
    },
    {
      name: "remove (many small interior cuts)",
      baseMs: 12.7,
      nowMs: 12.7 * 1.54,
      exponent: 1.13,
      maxExponent: 4.0,
      maxRatioVsBaseline: 2.0,
    },
  ];
  const { baseline, report } = replay(rows);
  const failures = report.render(baseline).map((r) => r.name);
  expect("uniform 1.45x machine slowdown -> no failures", failures.length, 0);
}

// ---------------------------------------------------------------------------
// 2. A per-case constant regression on ONE write row MUST fail, even while the
//    whole machine is slow. This is the property that makes the normalisation
//    safe rather than just permissive.
// ---------------------------------------------------------------------------
{
  const rows = [
    ...readsSlowed(1.45),
    // 3.3x raw against a 1.45x machine = 2.27n against a 2.0n gate.
    {
      name: "remove (many small interior cuts)",
      baseMs: 12.7,
      nowMs: 12.7 * 3.3,
      exponent: 1.1,
      maxExponent: 4.0,
      maxRatioVsBaseline: 2.0,
    },
  ];
  const { baseline, report } = replay(rows);
  const failures = report.render(baseline).map((r) => r.name);
  expect("per-case 2.27n regression on a slow machine -> caught", failures.length, 1);
  expect("...and it is the right row", failures[0], "remove (many small interior cuts)");
}

// ---------------------------------------------------------------------------
// 3. Worse-than-declared complexity still fails on the exponent, independent
//    of drift.
// ---------------------------------------------------------------------------
{
  const rows = [
    ...readsSlowed(1.0),
    { name: "put (append, sequential)", baseMs: 4.0, nowMs: 4.0, exponent: 1.9, maxExponent: 1.35 },
  ];
  const { baseline, report } = replay(rows);
  const failures = report.render(baseline).map((r) => r.name);
  expect("exponent over ceiling -> caught", failures.length, 1);
  expect("...by the scaling gate, not drift", failures[0], "put (append, sequential)");
}

// ---------------------------------------------------------------------------
// 4. Without enough reference rows there is no honest runner factor, so the
//    drift gate must report itself UNAVAILABLE and fail nothing on drift.
//    Silently falling back to the raw ratio would gate the hardware again.
// ---------------------------------------------------------------------------
{
  const rows = [
    READ("get hit", 2.1, 2.1 * 2.0), // only ONE reference row
    {
      name: "remove (many small interior cuts)",
      baseMs: 12.7,
      nowMs: 12.7 * 9.0, // enormous raw drift
      exponent: 1.1,
      maxExponent: 4.0,
      maxRatioVsBaseline: 2.0,
    },
  ];
  const { baseline, report } = replay(rows);
  const failures = report.render(baseline).map((r) => r.name);
  expect(
    `fewer than ${MIN_REFERENCE_DRIFTS} reference rows -> drift not gated`,
    failures.length,
    0
  );
}

// ---------------------------------------------------------------------------
// 5. A run at a different problem size than the baseline must not produce a
//    drift verdict at all (the ratio would measure the size difference).
// ---------------------------------------------------------------------------
{
  const rows = [
    ...readsSlowed(1.0),
    { name: "put (random order)", baseMs: 13.0, nowMs: 52.0, exponent: 1.5, maxExponent: 2.05 },
  ];
  const { baseline, report } = replay(rows, 20000, 40000);
  const failures = report.render(baseline).map((r) => r.name);
  expect("size mismatch -> drift never fires", failures.length, 0);
}

// ---------------------------------------------------------------------------
// 6. The exact CI table that failed, replayed. This is the regression test for
//    the specific failure: `put (random order)` at 1.77 vs the old 1.75 gate.
// ---------------------------------------------------------------------------
{
  const ci = [
    ["putCoalescing (append, sequential)", 10.9, 1.06, 1.65],
    ["putCoalescing (random order)", 25.9, 1.49, 1.41],
    ["put (append, sequential)", 6.0, 1.08, 1.55],
    ["put (random order)", 19.0, 1.77, 1.48],
    ["get hit", 2.9, 1.09, 1.35],
    ["get miss (in the gaps)", 2.8, 1.04, 1.34],
    ["remove (many small interior cuts)", 19.8, 1.13, 1.54],
    ["remove (wide chunks across the domain)", 0.056, 0.75, 1.89],
    ["subRangeMap (half the domain)", 2.0, 0.95, 2.02],
    ["subRangeMap (many small windows)", 1.3, 0.96, 1.68],
    ["asMapOfRanges (full materialise)", 0.999, 0.54, 1.27],
    ["span (n calls)", 1.1, 1.0, 1.37],
  ];
  const maxExp = {
    "putCoalescing (append, sequential)": 1.35,
    "putCoalescing (random order)": 2.05,
    "put (append, sequential)": 1.35,
    "put (random order)": 2.05,
    "get hit": 1.25,
    "get miss (in the gaps)": 1.25,
    "remove (many small interior cuts)": 4.0,
    "remove (wide chunks across the domain)": 1.35,
    "subRangeMap (half the domain)": 1.35,
    "subRangeMap (many small windows)": 1.5,
    "asMapOfRanges (full materialise)": 1.35,
    "span (n calls)": 1.35,
  };
  const isRef = new Set([
    "get hit",
    "get miss (in the gaps)",
    "asMapOfRanges (full materialise)",
    "span (n calls)",
  ]);
  const rows = ci.map(([name, nowMs, exponent, drift]) => ({
    name,
    baseMs: nowMs / drift,
    nowMs,
    exponent,
    maxExponent: maxExp[name],
    reference: isRef.has(name),
    maxRatioVsBaseline: name === "remove (many small interior cuts)" ? 2.0 : 3.0,
  }));
  const { baseline, report } = replay(rows);
  const failures = report.render(baseline).map((r) => r.name);
  expect("the CI run that failed, replayed against the fixed gate", failures.length, 0);
}

console.log(`\ngate self-test: ${checks} checks, ${bad.length} failure(s)`);
if (bad.length) {
  for (const b of bad) console.log(`  FAIL ${b}`);
  process.exit(1);
}
console.log("gate self-test OK — the gate is machine-independent on synthetic data");
