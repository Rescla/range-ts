# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-01

First major release. The breaking change is the end of ES5 output; everything else
is additive or tooling.

### Breaking
- **ES5 output dropped.** All build targets now compile to `es2020`. The
  `dist/esm5` build no longer exists and `package.json` `module` now points at
  `dist/esm`. Consumers still needing ES5 must transpile themselves or stay on
  0.1.x. This was forced by TypeScript 7 removing `target=ES5` (error TS5108),
  along with `baseUrl`, `moduleResolution=node10` and `downlevelIteration`.
- **`dist/karma` and `dist/spec-node` are no longer published.** They are test
  artifacts and were never part of the import surface.

### Added
- **Generic `Scalar<T>` support.** `Range<T>` and `RangeMap<K, V>` now work over
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

### Changed
- TypeScript 5 → 7; `cjs`/`esm`/`karma` targets `es5`/`es2015` → `es2020`.
- CI pins Node 22 via `actions/setup-node`, so the lockfile no longer depends on
  whichever npm the runner happens to ship. Actions bumped: `checkout` v2 → v7,
  `setup-node` → v7, CodeQL v1 → v4.
- `test:chrome` now compiles its own target and refuses to report success over a
  zero-spec run (previously a missing `dist/karma/test.js` produced
  `TOTAL: 0 SUCCESS`).

### Fixed
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
- Mutation score 78.9% → 94.9% (483 killed, 1 timeout, 26 surviving; 9 of the
  survivors are `__esModule` boilerplate, the rest equivalent mutants or
  defensive paths). Re-run after the `RangeMap` typing fix landed: 94.90%,
  483 killed / 1 timeout / 26 survived — unchanged.
- 174 specs passing across node, jsdom and Chrome.
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
