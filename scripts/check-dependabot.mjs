#!/usr/bin/env node
// Checks .github/dependabot.yml against rules that GitHub enforces but the
// published JSON Schema (json.schemastore.org/dependabot-2.0) does NOT.
//
// Why this exists: the schema is generic across ecosystems. It validates that
// `cooldown.semver-major-days` is an integer in 1..90 and is happily silent on
// which ecosystems may use it. GitHub's own validator rejects the file outright:
//
//   The property '#/updates/1/cooldown/semver-major-days' is not supported for
//   the package ecosystem 'github-actions'.
//
// So a config can pass schema validation, be committed, and still be dead. Worse,
// while the config is invalid Dependabot stops running version updates for the
// whole file -- the failure is not confined to the offending entry.
//
// Run: npm run check:dependabot   (also part of `npm test`)

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");

// semver-scoped cooldown keys. GitHub accepts these for npm only.
const SEMVER_COOLDOWN_KEYS = new Set([
  "semver-major-days",
  "semver-minor-days",
  "semver-patch-days",
]);
const SEMVER_COOLDOWN_OK = new Set(["npm"]);

const problems = [];
const notes = [];

// ---- rule 1: semver-*-days is npm-only -------------------------------------
let config;
try {
  config = yaml.load(readFileSync(".github/dependabot.yml", "utf8"));
} catch (e) {
  console.error(`check-dependabot: cannot parse .github/dependabot.yml: ${e.message}`);
  process.exit(1);
}

const updates = config?.updates;
if (!Array.isArray(updates) || updates.length === 0) {
  console.error("check-dependabot: no `updates:` entries found");
  process.exit(1);
}

updates.forEach((u, i) => {
  const eco = u["package-ecosystem"] ?? "(missing)";
  const cooldown = u.cooldown ?? {};
  const present = Object.keys(cooldown);
  const offending = present.filter((k) => SEMVER_COOLDOWN_KEYS.has(k));

  if (offending.length && !SEMVER_COOLDOWN_OK.has(eco)) {
    problems.push(
      `updates[${i}] '${eco}': ${offending.join(", ")} is not supported for this ` +
        `ecosystem (npm only). GitHub rejects the whole file, and while the file is ` +
        `invalid Dependabot stops version updates for EVERY entry, not just this one. ` +
        `Use 'default-days' instead.`
    );
  } else if (offending.length) {
    notes.push(`updates[${i}] '${eco}': ${offending.join(", ")} (allowed)`);
  }
  notes.push(`updates[${i}] '${eco}': cooldown = [${present.join(", ") || "none"}]`);
});

// ---- rule 2: cooldown must agree with min-release-age -----------------------
// npm enforces min-release-age with:
//   ETARGET  notarget No matching version found for <pkg>@<ver> with a date
//            before <date>
// which reads like "this version does not exist" rather than "this version is
// too new". If the two numbers drift apart, Dependabot opens PRs that fail CI
// pointing at an apparently broken dependency instead of at the quarantine.
let npmrcAge = null;
try {
  const npmrc = readFileSync(".npmrc", "utf8");
  const m = npmrc.match(/^\s*min-release-age\s*=\s*(\d+)\s*$/m);
  if (m) npmrcAge = Number(m[1]);
} catch {
  /* no .npmrc -- rule not applicable */
}

if (npmrcAge !== null) {
  notes.push(`.npmrc min-release-age = ${npmrcAge}`);
  updates.forEach((u, i) => {
    const eco = u["package-ecosystem"] ?? "(missing)";
    const dd = u.cooldown?.["default-days"];
    if (dd === undefined) {
      problems.push(
        `updates[${i}] '${eco}': no cooldown.default-days, but .npmrc sets ` +
          `min-release-age=${npmrcAge}. Dependabot will propose versions npm refuses ` +
          `to install, and CI will fail with a misleading ETARGET.`
      );
    } else if (dd < npmrcAge) {
      problems.push(
        `updates[${i}] '${eco}': cooldown.default-days=${dd} is SHORTER than ` +
          `.npmrc min-release-age=${npmrcAge}. Dependabot will propose versions the ` +
          `install gate rejects. Raise default-days to at least ${npmrcAge}.`
      );
    } else {
      notes.push(`updates[${i}] '${eco}': default-days=${dd} >= ${npmrcAge} (aligned)`);
    }
  });
} else {
  notes.push(".npmrc: no min-release-age set (rule 2 skipped)");
}

// ---- report ---------------------------------------------------------------
console.log("check-dependabot:");
for (const n of notes) console.log(`  ${n}`);

if (problems.length) {
  console.error(`\ncheck-dependabot: FAILED (${problems.length} problem(s))`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("check-dependabot: OK");
