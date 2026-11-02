#!/usr/bin/env node
/**
 * RangeMap performance suite.
 *
 *   npm run bench            report only, never fails
 *   npm run bench:check      gates on scaling exponents; exits 1 on regression
 *   npm run bench:baseline   rewrite bench/baseline.json from the current build
 *
 * Deliberately NOT wired into `npm test`. These runs take tens of seconds and
 * are timing-based; the unit suite must stay fast and deterministic. The gate
 * belongs in CI as its own step, where a slow box shows up as a slow step
 * rather than a flaky test.
 *
 * The gate is the scaling EXPONENT (see harness.mjs), which is
 * machine-independent. Absolute times are recorded for drift only.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Report, scaling } from "./harness.mjs";
import { scenarios } from "./cases.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(here, "baseline.json");

const args = process.argv.slice(2);
const mode = args.includes("--update-baseline")
  ? "baseline"
  : args.includes("--check")
    ? "check"
    : "report";

// Load the BUILT library, not the source. The whole point is to measure what
// ships, so a source change that never made it into dist cannot hide.
const libPath = process.env.BENCH_LIB || join(here, "..", "dist", "cjs", "index.js");
let mod;
try {
  mod = await import(libPath);
} catch (e) {
  console.error(`bench: cannot load ${libPath}`);
  console.error("  run `npm run compile` first");
  process.exit(2);
}

const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};

// Small n is chosen so the whole suite stays under a minute while still being
// large enough that O(n) vs O(n^2) is unambiguous. Below ~1000 the fixed
// costs dominate and every exponent reads near 0.
// 20k, not 4k. At n=4000 the whole op finishes in well under a millisecond and
// the exponent estimate is dominated by GC/allocation noise: `put (append)`
// measured O(n^2.04) at 4k->8k while the same code measures O(n^0.9-1.15)
// from 16k to 64k. A gate on a number that noise can move past 1.35 is a gate
// that fails at random, which trains people to ignore it. Override with
// BENCH_N=<n>.
const SMALL = Number(process.env.BENCH_N || 20000);
// WARMUP IS NOT COSMETIC AND MUST NOT BE PINNED LOW HERE.
// harness.timeOp's own comment documents that `warmup: 1, rounds: 5` samples
// entirely from the pre-optimisation band, and this runner is the only caller.
// The previous value here (`rounds: 5, warmup: 1`) was exactly that broken
// configuration, so `bench:check` failed roughly one run in two on unchanged
// code. Both knobs are env-overridable so a run can be reproduced exactly.
//
// Do NOT read the current settings as making every case tight. Warmup fixes the
// pre-optimisation band; it does not fix inter-scenario heap and thermal drift.
// The interior-remove case still spreads -0.19 .. 3.53 across full-suite runs
// while reading 0.57 .. 2.01 in isolation — see the note on that case in
// cases.mjs, which is where its gate is set and justified.
const OPTS = {
  rounds: Number(process.env.BENCH_ROUNDS || 7),
  warmup: Number(process.env.BENCH_WARMUP || 14),
};

/*
 * THE BASELINE IS CALIBRATED AT ONE SIZE, AND BOTH GATES ASSUME THAT SIZE.
 *
 * The exponent gates were tuned at n=20000 and the drift gate compares
 * ABSOLUTE times. Neither is valid at another n, and running `bench:check`
 * with a different BENCH_N proved it: at n=40000 against a 20000 baseline
 * the run reported 4 failures, 3 of them pure size mismatch -- doing twice
 * the work reads 2x-3.4x "drift", which is expected cost, not a
 * regression. (The fourth, `asMapOfRanges` at O(n^1.55), was a genuine
 * exponent wobble that only appears at the larger size.)
 *
 * So a size mismatch in check mode is a CONFIGURATION ERROR, not a gate
 * failure and not a pass. Failing it as a gate would be a false alarm;
 * letting it pass would make BENCH_N a way to switch the gate off without
 * anyone noticing. Checked BEFORE the suite runs, so a wrong size costs
 * nothing instead of four minutes.
 *
 * In report mode the mismatch is only a warning: exploring at another size
 * is legitimate, it just does not produce a verdict.
 */
const BASE_N = base.smallN ?? null;
const sizeMismatch = BASE_N !== null && SMALL !== BASE_N;

if (mode === "check") {
  if (!existsSync(BASELINE)) {
    console.error("\nbench:check: no baseline.json — run `npm run bench:baseline` first");
    process.exit(2);
  }
  if (sizeMismatch) {
    console.error(
      `\nbench:check: size mismatch — running at n=${SMALL}, but the baseline was ` +
        `recorded at n=${BASE_N}.\n` +
        `  Both gates (exponent thresholds and the drift ratio) are calibrated against ` +
        `that size and\n  are meaningless at another one. Either drop BENCH_N, or ` +
        `re-record the baseline\n  at the new size with \`npm run bench:baseline\` ` +
        `(which re-calibrates every gate).\n` +
        `  Nothing was measured and nothing was changed.`
    );
    process.exit(2);
  }
}

console.log(`RangeMap performance suite`);
console.log(`  lib: ${libPath}`);
console.log(
  `  n: ${SMALL} -> ${SMALL * 2}   rounds: ${OPTS.rounds}   warmup: ${OPTS.warmup}   mode: ${mode}\n`
);

if (sizeMismatch) {
  console.log(
    `  WARNING: baseline was recorded at n=${BASE_N}; this run is at n=${SMALL}. ` +
      `Absolute-time\n           drift is not comparable and is reported as n/a. ` +
      `Exponent rows are exploratory.\n`
  );
}

const report = new Report();
const fresh = {};

for (const sc of scenarios(mod)) {
  const s = scaling(sc.make, sc.op, SMALL, SMALL * 2, OPTS);
  const row = report.add({
    name: sc.name,
    scaling: s,
    maxExponent: sc.maxExponent,
    maxRatioVsBaseline: sc.maxRatioVsBaseline ?? 3.0,
  });
  fresh[sc.name] = { smallMs: s.smallMs, largeMs: s.largeMs, exponent: s.exponent };
}

const failures = report.render(mode === "baseline" ? {} : base);

if (mode === "baseline") {
  writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        _note:
          "Recorded absolute times for drift detection only. The gate is the exponent in bench/cases.mjs. Regenerate with `npm run bench:baseline` after an intentional performance change.",
        recordedAt: new Date().toISOString(),
        node: process.version,
        smallN: SMALL,
        measurements: fresh,
      },
      null,
      2
    )
  );
  console.log(`\nwrote ${BASELINE}`);
  process.exit(0);
}

if (mode === "check") {
  if (failures.length) {
    console.error(`\nbench:check FAILED — ${failures.length} measurement(s) out of bounds`);
    for (const f of failures) console.error(`  - ${f.name}`);
    process.exit(1);
  }
  console.log("\nbench:check OK — all measurements within declared complexity bounds");
  process.exit(0);
}

console.log("\nreport only (use `npm run bench:check` to gate)");
