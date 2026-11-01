// Post-build finalization for the published dist.
//
// Everything here is a TARGET-SPECIFIC quirk of how Node and bundlers resolve
// modules. None of it belongs in the source: the sources stay plain extensionless
// TypeScript, and this step shapes the emitted output to what each consumer
// actually requires.
//
// Three jobs:
//
// 1. ESM relative imports need explicit file extensions under Node's ESM
//    loader. TS emits `export * from "./core/bound-type"`, which a bundler
//    resolves and Node does not. Rewrite to "./core/bound-type.js".
//
// 2. Node decides whether a `.js` file is CJS or ESM from the nearest
//    package.json `type` field. Without a marker in each dist directory Node
//    emits MODULE_TYPELESS_PACKAGE_JSON and reparses every file to guess.
//    Write `{"type":"module"}` into dist/esm and `{"type":"commonjs"}` into
//    dist/cjs so the type is declared rather than inferred.
//
// 3. Verify the rewrite actually landed. A scripted edit that silently matched
//    nothing is the classic no-op failure: the build would "succeed" and ship
//    an ESM build Node still cannot load. So re-scan afterwards and fail
//    loudly on any leftover extensionless specifier.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not `new URL(...).pathname`: pathname returns the PERCENT-ENCODED
// form, so a repo under a path with a space or a non-ASCII character would give
// "%20/..." and every existsSync/read below would miss. Cheap insurance against a
// build that works on the maintainer's machine and fails on everyone else's.
const DIST = fileURLToPath(new URL("../dist", import.meta.url));

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".js")) out.push(p);
  }
  return out;
}

// Only touch module specifiers: `from "..."` (import/export, incl. `export *`)
// and dynamic `import("...")`. Relative-only; bare specifiers are packages and
// must not be rewritten. Already-extensioned specifiers are left alone.
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*)"(\/?\.\/[^"]+?|\.\.\/[^"]+?)"/g;

function needsExt(spec) {
  return !/\.(js|json|css|mjs|cjs)$/.test(spec);
}

let filesScanned = 0;
let filesRewritten = 0;
let specifiersRewritten = 0;

const esmFiles = walk(join(DIST, "esm"));
for (const file of esmFiles) {
  filesScanned++;
  const src = readFileSync(file, "utf8");
  let count = 0;
  const next = src.replace(SPECIFIER, (m, head, spec) => {
    if (!needsExt(spec)) return m;
    count++;
    return `${head}"${spec}.js"`;
  });
  if (count > 0) {
    writeFileSync(file, next);
    filesRewritten++;
    specifiersRewritten += count;
  }
}

// ---- job 2: module-type markers ----
const markers = [
  [join(DIST, "esm"), { type: "module" }],
  [join(DIST, "cjs"), { type: "commonjs" }],
];
for (const [dir, obj] of markers) {
  if (!existsSync(dir)) {
    console.error(`finalize-dist: expected ${dir} to exist — did the compile step run?`);
    process.exit(1);
  }
  writeFileSync(join(dir, "package.json"), JSON.stringify(obj, null, 2) + "\n");
}

// ---- job 3: verify the post-condition, do not trust the replace ----
const leftovers = [];
for (const file of walk(join(DIST, "esm"))) {
  const content = readFileSync(file, "utf8");
  for (const m of content.matchAll(SPECIFIER)) {
    if (needsExt(m[2])) leftovers.push(`${relative(DIST, file)} -> ${m[2]}`);
  }
}

console.log(
  `finalize-dist: scanned ${filesScanned} esm files, rewrote ${specifiersRewritten} ` +
  `specifier(s) in ${filesRewritten} file(s); wrote esm=module, cjs=commonjs markers`
);

if (leftovers.length > 0) {
  console.error(
    `finalize-dist: FAILED — ${leftovers.length} extensionless relative specifier(s) ` +
    `still present in dist/esm. Node cannot load these.\n  ` + leftovers.join("\n  ")
  );
  process.exit(1);
}

// The markers must be readable as JSON, or Node treats the directory as untyped.
for (const [dir] of markers) {
  const p = join(dir, "package.json");
  try {
    JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    console.error(`finalize-dist: FAILED — ${p} is not valid JSON: ${e.message}`);
    process.exit(1);
  }
}

console.log("finalize-dist: OK");
