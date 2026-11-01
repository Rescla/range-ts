# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Full reasoning and verification evidence for 1.0.0:
[docs/1.0.0-notes.md](docs/1.0.0-notes.md).

## [1.0.0] - 2026-11-01

First major release. Five breaking changes; the two most likely to hit you are
marked **check this**.

### Breaking

- **`intersection()` no longer returns `null` for a connected-but-empty result.**
  **Check this** if you test `=== null` on it — that branch now goes the other
  way. Use `.isEmpty()` for "no overlap".

  | call | 0.1.8 | 1.0.0 |
  | --- | --- | --- |
  | `closedOpen(0,2).intersection(closedOpen(2,2))` | `null` | `[2..2)` |
  | `closedOpen(0,2).isConnected(closedOpen(2,2))` | `false` | `true` |
  | `closedOpen(0,2).encloses(closedOpen(2,2))` | `false` | `true` |
  | `open(0,1).overlaps(open(0,1))` | `false` | `true` |

- **Inverted ranges throw at construction.** `NumberRange.closed(5, 1)` raises
  instead of building. **Check this** if you build ranges from unvalidated input
  — user input, parsed files, subtractions that can go negative. Equal-endpoint
  ranges (`(3..3)`, `[3..3]`) and `NaN` endpoints are unaffected.

- **Deep imports no longer resolve.** `require("range-ts/dist/cjs/index.js")` and
  friends fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Import from `range-ts`; all
  16 public names are reachable there. `range-ts/package.json` still resolves.

- **ES5 output dropped.** All targets are now `es2020` and `dist/esm5` is gone.
  Need ES5? Stay on 0.1.x or transpile yourself. (Forced by TypeScript 7 removing
  `target=ES5`.)

- **`dist/karma` and `dist/spec-node` are no longer published.** Test artifacts,
  never a supported import path.

### Added

- **`Scalar<T>` — ranges over exact domains.** Works over `bigint`, decimal
  wrappers, or your own type, with no dependency on any of them.
  `defineRange(bigintScalar)` returns a bound factory; `numberScalar` and
  `comparableScalar` cover the default behaviour. Infinity is an explicit value
  each scalar owns (`isPlusInfinity` / `isMinusInfinity`, never a single
  sign-merging `isInfinity()`); `null`/`undefined` never mean "unbounded".
  `number` keeps its native `±Infinity`.
- **`exports` map** with `types` / `import` / `require` — Node ESM now resolves to
  the real ESM build instead of CJS interop through `main`.
- **`dist/esm` loads in Node.** It used to emit extensionless relative imports,
  which bundlers resolve and Node cannot. `scripts/finalize-dist.mjs` adds the
  `.js` extensions and writes the `{"type":"module"}` / `{"type":"commonjs"}`
  markers.
- **`sideEffects: false`** — verified across every source file, not assumed.
- **Three test environments** — `test:node`, `test:jsdom`, `test:chrome`;
  `npm test` runs all three.
- **Mutation testing** — `npm run test:mutation` (Stryker).
- **Supply-chain controls in `.npmrc`** — `min-release-age=7` and
  `ignore-scripts=true`.
- **`npm run check:dependabot`** — enforces Dependabot rules the published JSON
  Schema does not cover (it is generic across ecosystems; GitHub's validator is not).
- **`src/karma.conf.ts`** replaces the `.js` config — TypeScript 7 removed the JS
  API that `ts-node` hooks, so it is compiled and run from `dist/karma-conf/`.

### Changed

- TypeScript 5 → 7; all build targets `es2020`.
- CI on Node 26 (LTS). Actions bumped: `checkout` v2 → v7, `setup-node` → v7,
  CodeQL v1 → v4.
- `test:chrome` compiles its own target and refuses to report success over a
  zero-spec run.

### Fixed

- `encloses` / `isConnected` / `intersection` / `span` now decide on Guava's
  `Cut` ordering instead of `contains`, which answered a question about the whole
  range and so was wrong for empty operands. Cross-listed under **Breaking**.
- Writing an empty range into a `RangeMap` no longer moves `span()` past entries
  that no listing shows.
- `subRangeMap` now forwards the parent's `eq`. It built the submap with
  `new RangeMap()`, so `putCoalescing` on a submap compared by `===` and silently
  stopped coalescing.
- Comparing ranges built over two different scalars throws instead of returning a
  wrong negative (`comparableScalar.compare(10, 10n)` is `NaN`).
- `RangeMap`'s range-returning methods no longer break 0.1.8 consumers at the
  type level. New third type parameter `R`, defaulting to `DefaultRange<P>`
  (`NumberRange` for `Comparable` points), so `new RangeMap<string>()` types
  exactly as before.
- Published tarball allowlisted: **81 files / 662 KiB** (0.1.8) →
  **54 files / 150 KiB**. Verify with `npm pack --dry-run`.
- `tsconfig.*.tsbuildinfo` no longer ships.
- The release workflow referenced an action that does not exist
  (`Github-Actions-Community/merge-release`); replaced with the plain
  `setup-node` publish path.
- The release workflow no longer falls back to `rows[0]` for the stage id — a
  filter miss used to print a *different* package's id with an instruction to
  approve it.
- `finalize-dist.mjs` resolved `dist` via `new URL(...).pathname`, which returns
  the percent-encoded form; a checkout under a path with a space broke the build.
  Now `fileURLToPath`.
- The custom-scalar example in the specs violated its own `Scalar.compare`
  contract: `all()` died with `Cannot convert <<MIN>> to a BigInt`.
- The README `RangeMap` example did not run (`Range.closedOpen` does not exist,
  and imports were missing). Fixed and executed against the packed artifact.
- Removed `karma-typescript` / `karma-typescript-es6-transform`: declared, never
  loaded, and their `typescript@<=5` peer conflicted with TS 7.

### Quality

- 223 specs across node, jsdom and Chrome (was 174).
- Mutation score 78.9% → 94.9% → 93.71% → **93.89%** (469 killed, 7 timeout,
  31 survived of 507). All 31 survivors individually classified — see the notes.
- Differential against 0.1.8 over the shared API surface: **no `true → false`
  regressions** and **no new throws on non-inverted input**.
- Legacy and exact-domain consumer projects typecheck under `strict` with
  `skipLibCheck: false`.

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
