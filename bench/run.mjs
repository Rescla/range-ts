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
const OPTS = { rounds: Number(process.env.BENCH_ROUNDS || 5), warmup: 1 };

console.log(`RangeMap performance suite`);
console.log(`  lib: ${libPath}`);
console.log(`  n: ${SMALL} -> ${SMALL * 2}   rounds: ${OPTS.rounds}   mode: ${mode}\n`);

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
  if (!existsSync(BASELINE)) {
    console.error("\nbench:check: no baseline.json — run `npm run bench:baseline` first");
    process.exit(2);
  }
  if (failures.length) {
    console.error(`\nbench:check FAILED — ${failures.length} measurement(s) out of bounds`);
    for (const f of failures) console.error(`  - ${f.name}`);
    process.exit(1);
  }
  console.log("\nbench:check OK — all measurements within declared complexity bounds");
  process.exit(0);
}

console.log("\nreport only (use `npm run bench:check` to gate)");
