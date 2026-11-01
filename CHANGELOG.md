# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-01

First major release. Two breaking changes: the end of ES5 output, and deep imports
being closed off. Everything else is additive or tooling.

### Breaking
- **ES5 output dropped.** All build targets now compile to `es2020`. The
  `dist/esm5` build no longer exists and `package.json` `module` now points at
  `dist/esm`. Consumers still needing ES5 must transpile themselves or stay on
  0.1.x. This was forced by TypeScript 7 removing `target=ES5` (error TS5108),
  along with `baseUrl`, `moduleResolution=node10` and `downlevelIteration`.
- **`dist/karma` and `dist/spec-node` are no longer published.** They are test
  artifacts and were never part of the import surface.
- **Deep imports are no longer resolvable.** `require("range-ts/dist/cjs/index.js")`,
  `import "range-ts/dist/esm/index.js"` and similar paths now fail with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`, because the package declares an `exports` map
  that exposes only `.` and `./package.json`. This was verified safe to do: every
  public name in the library (16 of 16) is already reachable from the package
  root, so a deep import could not obtain anything additional — it could only
  create a dependency on an internal *path*. The failure is loud and happens at
  the consumer's build time rather than silently. `range-ts/package.json` remains
  exported for tooling that reads the version.
  Before 1.0.0 there was no `exports` map, so anything under `dist/` was
  reachable by anyone who knew the layout.

### Added
- **Generic `Scalar<T>` support.** `Range<T>` and `RangeMap<T, P, R>` now work over
  any exact scalar type (BigInt, custom decimal/decimal.js wrappers) rather than
  being tied to JS `number`, without the library depending on any of them.
  - Infinity is an explicit value each scalar owns. There is no "absent means
    unbounded" convention, and `null` and `undefined` are never conflated.
  - Checks are directional (`isPlusInfinity` / `isMinusInfinity`); there is no
    single `isInfinity()` that could merge the two.
  - `number` keeps its native `±Infinity` and is not given the synthetic sentinel
    treatment — replacing a native capability would change behaviour for no gain.
- **Three test environments**: `npm run test:node`, `test:jsdom`, `test:chrome`.
  `npm test` runs all three.
- **Mutation testing** via Stryker (command runner over compiled CJS).
- **Supply-chain hardening** in `.npmrc`: `min-release-age=7` (refuse package
  versions published less than 7 days ago) and `ignore-scripts=true` (never run
  dependency lifecycle scripts). Verified against a clean `npm ci` + full build.
- **`exports` map** with `types` / `import` / `require` conditions, so Node ESM
  consumers get the real ESM build instead of falling back to CommonJS interop
  through `main`. Verified: `import.meta.resolve('range-ts')` now returns
  `dist/esm/index.js` where it previously resolved to `dist/cjs`.
- **`sideEffects: false`**, so bundlers can drop unused exports. This is asserted
  from evidence rather than assumed: all eight source files were checked for
  top-level side effects and none exist.
- **`dist/esm` is now loadable by Node's ESM loader.** It previously emitted
  extensionless relative imports (`export * from "./core/bound-type"`), which
  bundlers resolve but Node cannot, so the ESM build was bundler-only. A new
  `scripts/finalize-dist.mjs` build step adds explicit `.js` extensions and
  writes `{"type":"module"}` / `{"type":"commonjs"}` markers into `dist/esm`
  and `dist/cjs` so Node declares the module type instead of reparsing to guess
  (which emitted `MODULE_TYPELESS_PACKAGE_JSON`).
  The fix is deliberately in the build, not the source: the sources stay plain
  extensionless TypeScript and the target-specific shape is produced by the
  compile step. `finalize-dist.mjs` re-scans after rewriting and fails the build
  if any extensionless specifier survives, because a scripted replace that
  silently matched nothing would otherwise ship an ESM build Node still cannot
  load.
- **`src/karma.conf.ts`** replaces `src/karma.conf.js`. Karma 6 loads its config
  with a plain `require()` and TypeScript 7 removed the JS API
  (`transpileModule`, `createProgram`) that `ts-node` hooks, so runtime TS config
  loading is unavailable on this toolchain; the config compiles via
  `tsconfig.karmaconf.json` to `dist/karma-conf/karma.conf.js` and Karma runs
  that. All paths in it are anchored to the repo root rather than to the file,
  since the runnable copy sits in `dist/karma-conf/` and a `__dirname`-relative
  path written as if it were in `src/` would silently land coverage reports one
  level wrong. `karma.conf.ts` is excluded from the library builds so it cannot
  leak into the published bundles.

### Changed
- TypeScript 5 → 7; `cjs`/`esm`/`karma` targets `es5`/`es2015` → `es2020`.
- CI pins Node 26 via `actions/setup-node`, so the lockfile no longer depends on
  whichever npm the runner happens to ship. Actions bumped: `checkout` v2 → v7,
  `setup-node` → v7, CodeQL v1 → v4.
- `test:chrome` now compiles its own target and refuses to report success over a
  zero-spec run (previously a missing `dist/karma/test.js` produced
  `TOTAL: 0 SUCCESS`).

### Fixed
- **`encloses`, `isConnected`, `intersection` and `span` now compare *cuts*, not
  containment.** They were written with `contains`, which answers a question about
  the whole range — so for an EMPTY range it comes back false at both ends for
  reasons that have nothing to do with the bound under test, and a range that
  plainly contains the empty one reported that it did not. The four methods are
  now decided on Guava's `Cut` ordering, where a bound's position depends on both
  its open/closed type and whether it is a lower or an upper bound
  (lower `CLOSED(v)`→`(v,0)`, lower `OPEN(v)`→`(v,1)`, upper `CLOSED(v)`→`(v,1)`,
  upper `OPEN(v)`→`(v,0)`). Concretely:
  - `[3..6]` now encloses the empty `[4..4)` (it always should have; Guava's own
    javadoc lists this case).
  - `(3..6]` still does *not* enclose `[3..6]` — an open lower cut sits above a
    closed one, which `contains` could not express either way.
  - `[0..2)` is now connected to the empty `[2..2)`, and their intersection is
    that empty range rather than `null`. `null` means "not connected", which is a
    different fact from "connected with no overlap".
  Verified against a reference implementation of Guava's `Cut` model over all
  1296 ordered range pairs (values 0..3, all four bound-type combinations,
  empties included): 0 divergences on all five methods.
- **Writing an empty range into a `RangeMap` no longer moves the span of a range
  no listing shows.** The entry was stored, and `asMapOfRanges` /
  `asMapOfValues` filtered it out while `span` did not — so `put([0..1), 'a')`
  followed by `put([100..100), 'b')` reported a span of `[0..100)` for a map
  that visibly held one entry. Fixed at the write side (`combinedPut` now no-ops
  on an empty range, matching Guava and matching what `remove` already did), so
  no reader has to remember to filter and no future reader inherits the trap.
  `remove(empty)` is likewise a no-op that strands nothing.
- **`subRangeMap` no longer drops the parent's equality function.** It built the
  submap with `new RangeMap()`, so `putCoalescing` on a submap decided "same
  value" by `===` while the map it came from used whatever the owner supplied.
  The README's own shape — a `RangeMap<string[]>` built with lodash `isEqual` and
  written back through `subRangeMap` — coalesced correctly on the parent and
  silently stopped coalescing as soon as the write went through a submap. `eq`
  is now forwarded on every construction path, including the empty-submap path.
- **Comparing ranges built over different scalars now throws instead of returning
  a wrong answer dressed as a negative one.** `comparableScalar.compare(10, 10n)`
  is `NaN`, so `NumberRange.closed(0, 10).contains(10n)` was `false` and the
  same propagation made a `bigint` endpoint read as outside a range whose own
  endpoint it equals. Where two ranges' scalars are different objects *and* the
  comparison comes back unordered, `encloses` / `isConnected` / `intersection` /
  `span` now throw with instructions to build both ranges from the same scalar.
  The guard is deliberately narrow: it fires on the unordered result only, so a
  same-scalar `NaN` (a documented non-answer) still propagates as `false`, and
  two scalars that *do* order the values still compare normally. Note that the
  typed API already refuses most of these calls at compile time — `bigint` does
  not satisfy `Comparable` — so this guard is defence for plain-JS consumers and
  `any`-cast call sites rather than the primary barrier.
- **`tsconfig.*.tsbuildinfo` no longer ships.** Three of them were in the tarball
  (they were in 0.1.8 too). They are incremental-compiler state that a consumer
  cannot use, and they must stay on disk for `tsc -b` to be incremental, so they
  are excluded at pack time with `!**/*.tsbuildinfo` in `files` rather than
  deleted by the build. `.npmignore` was tried first and does nothing here — a
  `files` allowlist overrides it — so the exclusion lives in `files` itself.
  Tarball: 57 files → 54.
- **The README's `RangeMap` example did not run.** It called
  `Range.closedOpen(1, 5)`, but `Range` has no static constructors — the statics
  live on `NumberRange` (and on factories from `defineRange`). It also used
  `RangeMap` and `NumberRange` without importing them. Both corrected, and the
  example was executed against the packed artifact to confirm it now produces
  exactly the output its own `expect` asserts.
- **Published tarball: 469 files / 14.2 MB → 55 files / 150 kB.** There was no
  `files` allowlist, so npm shipped the entire repo minus `.gitignore`: every
  tsconfig, `stryker.conf.json` and `tsconfig.tsbuildinfo`.
- **The release workflow referenced a repository that does not exist**
  (`Github-Actions-Community/merge-release@main`): API 404 on every casing
  variant, `git ls-remote` falls through to a credentials prompt. Replaced with
  the plain `setup-node` registry-auth publish path, so there is no third-party
  action to audit and nothing floating on an unregistered org name.
- Removed `karma-typescript` / `karma-typescript-es6-transform` devDependencies:
  declared but never loaded (the Karma pipeline uses `karma-webpack`), and their
  `typescript@<=5` peer made them incompatible with TS 7.
- **`RangeMap`'s range-returning methods no longer break 0.1.8 consumers at the
  type level.** Going generic widened `getEntry`, `span`, `asMapOfRanges` and
  `asMapOfValues` from `NumberRange` to `Range<P>`, so unchanged 0.1.8 code
  like `const s: NumberRange = m.span()` stopped compiling with
  `'Range<any>' is missing the following properties from type 'NumberRange':
  lowerEndpointValue, upperEndpointValue`. The runtime object was a
  `NumberRange` throughout — only the declaration had regressed. `RangeMap`
  now takes a third type parameter `R`, the concrete range class it accepts
  and hands back, defaulting to the new exported `DefaultRange<P>`:
  `NumberRange` for `Comparable` points, plain `Range<P>` otherwise. So
  `new RangeMap<string>()` is typed exactly as in 0.1.8, while
  `new RangeMap<string, BigIntPoint>()` still gets `Range<BigIntPoint>` with no
  extra annotation. The default is written `[P] extends [Comparable]` rather
  than `P extends Comparable` deliberately: the bare form distributes over a
  union point type, and `BigIntPoint` *is* a union
  (`bigint | "+INF" | "-INF"`), which produced an unusable
  `Range<bigint> | Range<"+INF"> | Range<"-INF">` at every exact-domain call
  site.

### Quality
- `npm run test:mutation` added as the scripted entry point for Stryker. The
  config existed but no script did, so the 94.9% figure below had no
  documented way to reproduce it.
- Corrected comments that still asserted ES5 / `esm5` build targets after 1.0.0
  removed them (`bigintScalar.succ`, `scalar-range.spec.ts`). The code was
  fine; the justification named a deleted target.
- `Scalar.compare` now documents the unordered-operand case explicitly: return
  `NaN` for values like `NaN` rather than picking a direction or returning 0.
  This matches what `comparableScalar` already did and what 0.1.8 behaved as,
  but the interface previously promised a strict trichotomy it did not keep.
- Mutation score 78.9% → 94.9% → **93.71%** (455 killed, 7 timeout, 31 survived
  of 493). The dip from 94.9% is the cut-order rewrite adding code, not tests
  getting weaker; the survivors are classified below rather than left as a
  residue.
- **All 31 remaining survivors are accounted for**, and none is a gap:
  - 9 are `__esModule` / `"use strict"` boilerplate on line 2 of each compiled
    file — not library logic.
  - 4 (`intersection`/`span` `>=`→`>` and `<=`→`<` at an exactly-equal cut) are
    **provably equivalent**: `lowerSide`/`upperSide` are injective, so equal
    cut-sides imply equal bound types, and picking `other` where the cuts tie
    yields an identical bound.
  - 1 (`if (!s.succ)` → `false`) is absorbed by the `try`/`catch` in `step`,
    which turns the missing-`succ` `TypeError` into `null` and so into the same
    `false` answer.
  - 1 (`const toDelete = { toDeleteId: Math.random() }` → `{}`) is equivalent:
    `remove` compares by object identity, and the field is decorative.
  - 3 (`combinedPut`'s empty-range guard, and the `intersection(...)?.isEmpty()`
    guard) survive because the invariant is enforced twice over. `fromRangeValues`
    is `private static`, so with the write-side guard no empty range can enter
    `rangeValues` through any public path; disabling either brace alone still
    leaves the other holding. Kept deliberately — the write-side guard is the one
    that stops the bad state from ever existing.
  - 13 are the read-side empty filters in `asMapOfRanges` / `asMapOfValues` /
    `span` and their `.filter()` chains, redundant for the same reason. They are
    cheap defence-in-depth against a future write path that forgets the guard.
  - 3 are error-message fragments in the new cross-scalar `throw` (control flow
    is unchanged; only the prose differs).
- **Two survivors that were *not* equivalent are now killed.** Removing the
  `nxt !== null` guard in `isAdjacentTo` was uncaught until the zero-endpoint
  case was tested: `bigintScalar.compare(null, 0n)` returns `0` — "equal" —
  because `null` is neither infinity and neither ordering comparison holds, so a
  failed `succ` against a range with a `0` lower endpoint became a **false
  positive adjacency**. The existing test used a `5` endpoint, where
  `compare(null, 5n)` is `-1` and the answer happens to stay correct. All 14
  mutants on those two lines now die, including the null-guard removal.
- 207 specs passing across node, jsdom and Chrome (was 174; +33 for cut order,
  empty-range `RangeMap` semantics, the cross-scalar guard, the throwing-`succ`
  cases and the sentinel pins).
- **Published artifact verified against 0.1.8 by installing the packed tarball
  into clean consumer projects**, not by inspecting the build directory:
  - `main` (`dist/cjs`) and `types` (`dist/types`) unchanged; `module` moved
    `dist/esm5` → `dist/esm` (the intended breaking change).
  - CJS `require` smoke test: identical results to 0.1.8 across `RangeMap.get`,
    `contains`, and `toString` rendering (`[1..5]`, `[0..+∞)`, `(-∞..+∞)`).
  - Node ESM `import` and dynamic `import()` both resolve and work.
  - `dist/esm` contains no CJS markers; `dist/cjs` is proper CJS.
  - **Backwards compatibility confirmed at the type level** — *this claim was
    WRONG as originally written, and is left visible rather than quietly
    deleted.* It read: "the 0.1.8 usage pattern `new RangeMap<string>()` +
    `NumberRange.closedOpen(...)` typechecks clean against 1.0.0 under
    `strict` with `skipLibCheck: false`." The pattern tested built the ranges
    but never annotated the values that come back. Re-running the same consumer
    file against both versions: **0.1.8 PASS, 1.0.0 FAIL** on all four
    range-returning methods. See the `Fixed` entry above for the cause and the
    fix; that same consumer file now typechecks clean against 1.0.0.
  - The new exact-domain path works in the shipped artifact: a `bigint` range
    correctly distinguishes `2^53 + 1` from `2^53`, which a JS `number`
    cannot. This is the feature's whole reason to exist and it was verified
    running, not just typed.

## [0.1.7] - 2022-09-16
https://github.com/Rescla/range-ts/releases/tag/v0.1.7
Fixes/improvements related to https://github.com/Rescla/range-ts/issues/23

### Added
- Testcases that use Dates

### Changed
- Format endpoints in RangeMap.toString() with .toISOString(), if available.
  - This is an improvement over Date.toString() for Dates, but using valueOf() instead might be more consistent.

### Fixed
- Use valueOf() when checking endpoints in NumberRange
  - Dates caused issues, since Date(0) !== Date(0), but Date(0).valueOf() === Date(0).valueOf()
