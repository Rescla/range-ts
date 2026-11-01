# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Full reasoning and verification evidence for 1.0.0:
[docs/1.0.0-notes.md](docs/1.0.0-notes.md).

## [1.0.0] - 2026-11-01

First major release. Eight breaking changes; the five most likely to hit you are
marked **check this**. Three of them (frozen `Range`, stricter comparator,
validated bound types) are security fixes first, but they can break code that
relied on the old permissiveness — full rationale under **Security**.

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

- **`Range` instances are frozen.** `Object.freeze(this)` now runs last in the
  constructor and both prototypes are frozen, so a range cannot be mutated after
  it is built. **Check this** if you subclass `Range` and assign your own instance
  fields after `super()` — that now throws. Use prototype members, or pass
  everything through the constructor. TypeScript consumers who write to a field
  get `TS2540` at compile time; plain-JS consumers in sloppy mode get a **silent
  no-op** — the write neither throws nor lands. Full rationale under **Security**.

- **`comparableScalar` no longer orders non-numeric operands.** It returns `NaN`
  (unordered) instead of coercing, because `<` / `>` coerce differently by type
  pair: `compare("9","10")` was `1` while `compare(9,"10")` was `-1`.
  **Check this** if you ever passed strings or other non-numbers to a range over the
  default scalar and relied on them sorting. `bigint` still orders against
  `number`, including past 2^53.

- **Invalid bound types throw at construction.** Anything that is not exactly
  `BoundType.OPEN` or `BoundType.CLOSED` now raises instead of being silently read
  as `CLOSED` (the permissive member, which *includes* the endpoint).
  **Check this** if bound types come from JSON, a cast, or any unvalidated source —
  `"OPENN"` used to construct and log as `[1..5]`.

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

### Security

A full audit found **no remotely triggerable vulnerability and no
prototype-pollution path** (re-tested by driving `JSON.parse('{"__proto__":…}')`
through `put`/`get`/`asMapOfRanges`/`asMapOfValues`/`subRangeMap`). It found
six ways to break an invariant the library asserts about itself, each producing
a silently wrong answer rather than an error. All six fixed and pinned by tests;
full reasoning in [docs/1.0.0-notes.md](docs/1.0.0-notes.md).

- **`Range` instances are frozen** — constructor guarantees can no longer be
  undone by a later field write. (Breaking; see above.)
- **`comparableScalar` returns `NaN` for non-numeric operands** — `<`/`>` coerce
  differently by type pair, so the comparator was inconsistent. (Breaking; see
  above.)
- **Bound types validated at construction** — anything not exactly `OPEN`/`CLOSED`
  used to be read as `CLOSED`, the permissive member. (Breaking; see above.)
- **`likeRange` will not call a non-`Range` constructor** — it reflected
  `proto.constructor` and invoked it with library-computed arguments.
- **`get` / `getEntry` are O(log n)** — were a linear `find` over the
  insertion-order array (~400 us per lookup at 10k entries; now ~0.2 us).
- **CI token permissions made explicit** — `main.yml` and `codeql-analysis.yml`
  had no `permissions:` key and inherited the repo default.

### Performance

- **`RangeMap` writes are no longer O(n²).** Every write (`put`,
  `putCoalescing`, `remove`) previously walked the whole entry array; a
  40 000-entry build took **15.0 s**. Writes now bound the overlapping window
  with two binary searches and one `splice` — O(log n + k). Same build:
  **~0.1 s**. At n=4000→8000: `put` 118× faster, `remove` 107×,
  `putCoalescing` 46×.
- **Check this if you build large maps in a loop**: no API change, but a
  workload that previously timed out should now complete.
- The algorithm is ported from Guava's `TreeRangeMap`; the **data structure
  deliberately is not**. A sorted array beats a skip list in JS (100k lookups:
  19.6 ms vs 56.7 ms) because `splice` is a native `memmove` ~50× cheaper
  per element than a JS-level scan, and reads dominate.
- Stated guarantee: **reads O(log n); writes O(n) worst case** with a native
  memmove constant. Interior removes are still quadratic in the limit
  (measured O(n^2.03)) but 300–500× faster than the old scan at every size.
- **New `npm run bench` / `bench:check` / `bench:baseline`** — separate from
  `npm test`. Gates on the scaling *exponent* (machine-independent) rather
  than absolute time, with 11 scenarios. Not a regression gate you can skip:
  it is what would have caught the original O(n²).

### Quality

- 289 specs across node, jsdom and Chrome (was 223).
- Mutation score 78.9% → 94.9% → 93.71% → 93.89% → 94.27% → **93.03%**
  (637 killed, 17 timeout, 49 survived of 703). The dip is denominator, not
  coverage: the rewrite added 92 mutants, 7 of them real gaps now pinned by
  specs carrying the exact witness that kills each one.
- All survivors in the rewritten write path individually classified by
  **patching each mutant into a copy of the build and searching 6 000
  randomised sequences for a distinguishing input**: 7 killable (now killed),
  8 proven genuinely equivalent (no input distinguishes them, so a spec would
  be theatre). The first pass at this was wrong twice — 1-based column offsets
  shifted every patch a character, and two near-identical search functions
  made a first-match replace hit the wrong one.
- The new `bound-type.js` file went 67.65% → 91.18% under the same scrutiny;
  its three remaining survivors are TypeScript's emitted `__esModule`
  prologue, not library logic.
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
