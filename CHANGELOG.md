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

  | call                                            | 0.1.8   | 1.0.0    |
  | ----------------------------------------------- | ------- | -------- |
  | `closedOpen(0,2).intersection(closedOpen(2,2))` | `null`  | `[2..2)` |
  | `closedOpen(0,2).isConnected(closedOpen(2,2))`  | `false` | `true`   |
  | `closedOpen(0,2).encloses(closedOpen(2,2))`     | `false` | `true`   |
  | `open(0,1).overlaps(open(0,1))`                 | `false` | `true`   |

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
  as `CLOSED` (the permissive member, which _includes_ the endpoint).
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

- **`RangeMap` silently lost writes on fully-open ranges.** In 0.1.8
  `isConnected(X, X)` returned `false` when `X` was fully open — only that
  shape; `[a..b]`, `[a..b)` and `(a..b]` were fine. `combinedPut` used
  `isConnected` to decide which existing entries a write affects, so a
  fully-open range did not connect to _itself_: the old entry was never
  removed, the new one was appended, and `get` (a `find` in insertion order)
  kept returning the **stale** value.

  | after `put(open(1,2), "a")` then `put(open(1,2), "b")` | 0.1.8         | 1.0.0     |
  | ------------------------------------------------------ | ------------- | --------- |
  | `asMapOfRanges()`                                      | two entries   | one entry |
  | `get(1.5)`                                             | `"a"` (stale) | `"b"`     |

  `remove(open(1,2))` likewise left the entry in place. Found by a 5 000-trial
  randomised differential of 0.1.8 against this release: 29 953 compared
  operations, 5 point-mapping differences, **all** of them this bug, and in
  every one 1.0.0 is the correct side. No case was found where 1.0.0 behaves
  worse than 0.1.8, and no throw-behaviour differences in either direction.

- `putCoalescing` with an **empty range now bridges**, as Guava documents
  ("it may be between two ranges we can coalesce").
  `putCoalescing([1..1), a)` on `{ [0..1)=a, [1..2)=a }` now yields
  `{ [0..2)=a }`; previously it silently did nothing. Verified against a
  Guava-faithful reference model over 24 000 operations that include empty
  operands: zero missed bridges, zero point-mapping differences. Plain `put`
  of an empty range is still a no-op.
- `bigintScalar.compare` returned `0` for operands it could not order, so a
  bigint range **contained garbage**: `closed(1n, 10n).contains("x")` was
  `true`. `numberScalar` and `comparableScalar` both return `NaN` for
  unordered operands; the bigint path was missed. Fixed while preserving the
  intentional `4n == 4` equality and exact ordering beyond 2^53.
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
  filter miss used to print a _different_ package's id with an instruction to
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
- **`subRangeMap` returned base `Range` objects under a signature that said
  `R`.** `Range.intersection` constructs `new Range(...)` directly — it does
  not route through the class-preserving builder — so on a map of
  `NumberRange`s the keys of `subRangeMap(...).asMapOfRanges()` were base
  `Range`s typed as `NumberRange`. It compiles clean and fails at the first
  `instanceof`, or the first call to a subclass-only method on a key read out
  of the map. The comment on the cast previously asserted the opposite
  (“`intersection` preserves the receiver's class”); it does not. The body
  now rebuilds through `likeRange` off the stored entry, so `subRangeMap`
  carries the same class contract `span()` already had (pinned by a spec).
  Costs ~10% on that call — see Performance.

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
  insertion-order array; now a binary search over the always-sorted entry array
  (~0.5 µs per lookup at 40k entries, measured against the built artifact).
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
  memmove constant. Interior removes are still quadratic in the limit but
  300–500× faster than the old scan at every size. The bench exponent on that
  case resolves only to ±1.5 on a shared box, so its gate guards gross
  regression only — see the retraction in `docs/1.0.0-notes.md`.
- **`subRangeMap` no longer scans the whole map.** It intersected _every_
  entry, so a one-entry submap out of a 100 000-entry map still cost
  100 000 intersections — O(n) per call, O(n²) across a loop of small
  submaps. It now brackets the intersecting window with the same two binary
  searches the write path uses: **O(log n + k)**, like Guava. Measured
  O(n^2.0) → O(n^1.0) on the new `subRangeMap (many small windows)` bench
  case. No API change.
- **`span()` no longer copies the entry array** to filter it; it scans in
  from the sorted ends. Same result, no allocation, O(1) in the common case.
- **`npm run bench:check` is now a gate that actually gates.** It was wired
  to nothing, and when run by hand it failed roughly one time in two on
  unchanged code. Three causes: the runner overrode the harness's required
  warmup with `warmup: 1`; the drift comparison read the baseline file at
  the wrong nesting level and so could never fire; and the two sizes were
  timed in separate phases, which multiplies noise into the ratio instead
  of cancelling it. Now: warmup 14 / rounds 7 (both env-overridable),
  paired interleaved measurement, live drift column, **12 scenarios**, and a
  step in CI. Three consecutive green runs after the change; the residual
  wobble on the allocation-heavy interior-remove case is documented rather
  than smoothed over. See
  [docs/1.0.0-notes.md](docs/1.0.0-notes.md#benchmarking-notes--five-things-this-harness-got-wrong-before-it-was-right).
- **The bench gate no longer gates the hardware.** The first CI run failed
  `put (random order)` at O(n^1.77) against a 1.75 gate on unchanged code,
  with _every_ row 1.27×–2.02× slower than the dev-box baseline. Two causes,
  both fixed:
  - **Drift is normalised.** Each row’s ratio is divided by a **runner
    factor** — the median drift of the four pure-read rows, which no
    write-path change can slow. A uniformly slower machine cancels; a
    per-case regression still stands out. On the failing CI run the runner
    factor was 1.35× and the worst row normalised to 1.50n. The reference
    set is the load-bearing part: taking the median over all rows would let a
    change that slows the whole write path drag the factor up with it and
    normalise itself away.
  - **Mixed-class rows are gated at their class ceiling, not their
    measurement.** A random-order build is genuinely quadratic — each insert
    shifts ~n/2 entries — and its exponent blends CPU-bound JS work with
    memory-bandwidth-bound `memmove`, so the blend weight moves with the
    machine: 1.45 on the dev box, 1.77 on the runner, against a 0.25 margin.
    More fundamentally, an exponent cannot separate “quadratic with a tiny
    constant (fine)” from “quadratic with a big constant (not fine)”. Those
    two rows now gate at 2.05 — worse-than-class — and the constant is
    guarded by normalised drift, where the old scan-and-rebuild would read
    ~15n.
- **`npm run bench:selftest`** (a CI step, instant) feeds the gate synthetic
  numbers whose machine properties are known and asserts what it concludes:
  a uniform 1.45× slowdown fails nothing; a 2.27n per-case regression is
  caught; too few reference rows reports the drift gate **UNAVAILABLE**
  rather than silently gating on the raw ratio; and the exact CI table that
  failed is replayed and must pass.
- **Runner image pinned to `ubuntu-24.04` in all three workflows.** GitHub is
  migrating `ubuntu-latest` from 24.04 to 26.04 between 2026-10-19 and
  2026-11-19 (GitHub changelog, 2026-09-17), so during that window
  `ubuntu-latest` resolves to whichever of two operating systems the rollout
  happens to have reached — an OS change underneath a timing gate, with no
  commit to point at. Moving to 26.04 should be a deliberate change with the
  bench re-run against it, not a Tuesday surprise.
- **`bench:check` refuses to run at a size other than the baseline’s.**
  Both gates are calibrated at one n. Running at n=40000 against a 20000
  baseline reported 4 failures, 3 of them pure size mismatch — twice the work
  reads ~2× “drift”, which is expected cost, not a regression. A size
  mismatch in check mode is now a **configuration error**: exit 2, nothing
  measured, caught in 0.1 s instead of costing four minutes and then lying.
  In report mode it warns and the drift column reads `n/a@20000`.
- **The interior-remove row has a guard that bites.** Its exponent gate (4.0)
  is informational — the spread on that allocation-heavy workload is wider
  than any useful threshold, so the exponent cannot see a 2× regression there.
  The row now sets `maxRatioVsBaseline: 2.0` explicitly instead of inheriting
  3.0: paired runs read 0.99×–1.02×, so 2.0 keeps ~2× headroom while still
  catching “still linear, twice as slow” — the regression class an exponent
  gate structurally cannot see. Only trustworthy because of the size check
  above; before it, “primary guard” was doing its arithmetic across two
  problem sizes and meant nothing.
- **`subRangeMap` class preservation costs ~10%** (1.10× / 1.12× drift on its
  two bench cases): one extra range construction per intersected entry. Paid
  deliberately for a return type that is true.

### Quality

- 314 specs across node, jsdom and Chrome (was 223 at 0.1.8).
- The Guava differential runs on a **wider value space** — four distinct
  values instead of two, quarter-step probes instead of halves. A two-value
  alphabet gives only 2^_k_ distinct value patterns over _k_ writes, so
  most of the interleavings a real map sees (a third value between two
  same-value ones, a fourth absorbing a boundary) were never generated at
  all. Wider alphabet, more patterns, harder merges.
- Joined by an **exact-domain (`bigint` id) differential**: every id in the
  domain probed after every operation, so a boundary wrong by exactly one
  point — one lost record, silently — has nowhere to hide. On a continuous
  domain probed at halves that failure is invisible; on an id domain it is
  the whole point. Current: numeric `ops=24000 structDiff=21` (all
  over-merge, 0 under-merge); exact `ops=18000 singlePoint=550
structDiff=48` (all over-merge, 0 under-merge); empty-range bridges fire
  on both.
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
- `npm test` now runs `format:check`. Formatting was previously CI-only, so a
  locally-green tree could still fail the pipeline; local green now means CI
  green on that axis.

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
