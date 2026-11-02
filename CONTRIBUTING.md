# Contributing

Thanks for taking an interest. This is a small library and the bar for a contribution
is low, but there are a few environment-specific traps that cost real time if you
hit them cold.

## Getting set up

```bash
npm ci          # NOT npm install -- see the note about --omit=optional below
npm run build   # clean + compile + test
```

`npm ci` reads `package-lock.json`. It should complete with no lifecycle-script
output; if you see scripts running, something is wrong with `.npmrc`.

## The traps

### Never pass `--omit=optional`

TypeScript 7 ships its actual compiler as a **platform-specific
`optionalDependency`**. `npm ci --omit=optional` (or `--no-optional`) deletes the
compiler and you get a build that fails in a way that looks like a TypeScript bug.
This repo has been bitten by it before.

The same applies to `NODE_ENV=production` installs.

### `.npmrc` is load-bearing

This repo ships an `.npmrc` with:

- `ignore-scripts=true` — dependency lifecycle scripts never run on install.
- `min-release-age=7` — refuses package versions published less than 7 days ago.

Both are deliberate supply-chain controls. If a dependency legitimately needs an
install script, do not remove the setting globally; raise it as a question first.

**If you change `min-release-age`, change `cooldown.default-days` in
`.github/dependabot.yml` to match.** npm enforces the gate with
`ETARGET: No matching version found for <pkg>@<ver> with a date before <date>`,
which reads like "this version does not exist" rather than "this version is too
new". If the two drift apart, dependabot opens PRs that fail CI pointing at an
apparently broken dependency instead of at the quarantine.

### Dependabot config: the JSON Schema is not the validator

`.github/dependabot.yml` validates cleanly against
`json.schemastore.org/dependabot-2.0` and can _still_ be rejected by GitHub,
because the published schema is generic across ecosystems and the
ecosystem-specific rules live only in GitHub's own validator. Concretely:

- `cooldown.semver-major-days` / `-minor-` / `-patch-` are accepted for **npm
  only**. On `github-actions` GitHub rejects the file with
  `The property '#/updates/N/cooldown/semver-major-days' is not supported for the
package ecosystem 'github-actions'`.
- While the config is invalid, Dependabot **stops running version updates for the
  whole file** — the damage is not confined to the offending entry.

So "the schema says it's fine" is not evidence. `npm run check:dependabot`
(which runs as part of `npm test`) enforces the ecosystem rule and also checks
that `cooldown.default-days` is not shorter than `min-release-age` in `.npmrc`.

### Do not use `BigInt` literals in source

Write `BigInt(1)`, not `1n`. A literal is a syntax error against some of the
compilation targets this project has historically supported, and the check that
enforces it is a lint rule that is easy to bypass locally.

### Infinity is a value, not an absence

In the `Scalar` abstraction, unbounded bounds are **explicit values the scalar
owns**. There is no "absent means unbounded" convention, and `null` and
`undefined` are never conflated. Checks are directional — `isPlusInfinity()` /
`isMinusInfinity()` — and there is deliberately no single `isInfinity()` that
could merge the two signs.

`number` keeps its native `±Infinity` and is not given the synthetic sentinel
treatment; replacing a native capability changes behaviour for no gain.

### Deep imports are not supported

Import from `"range-ts"`. `require("range-ts/dist/cjs/index.js")` fails with
`ERR_PACKAGE_PATH_NOT_EXPORTED`. Everything public is reachable from the package
root; if you find yourself wanting a deep import, that is a signal something is
missing from the index and worth an issue.

## Commands

| Command                 | What it does                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `npm test`              | Runs all three environments (node, jsdom, chrome)                                                    |
| `npm run test:node`     | Specs in Node only                                                                                   |
| `npm run test:jsdom`    | Specs in jsdom                                                                                       |
| `npm run test:chrome`   | Specs in real Chrome. Compiles its own target and **refuses to report success over a zero-spec run** |
| `npm run test:mutation` | Stryker. Run `npm run compile:spec-node` first if you have not built                                 |
| `npm run build`         | `build:clean` + `compile` + `test`                                                                   |

`test:chrome` needs a Chromium binary on `PATH`. It is resolved by PATH lookup, so
it works on any machine with Chrome/Chromium installed; it does not assume nix.

## Testing expectations

- **New behaviour needs a test that fails without it.** Mutation score is tracked;
  a change that lowers it will be asked about.
- Tests run in three environments for a reason. If you add something DOM-related,
  it belongs in the jsdom/chrome path, not the node path.
- `toThrowError(...)` is required for regex matching under Jasmine 5; `toThrow`
  does not behave as expected there.

## Style

- Formatting is Prettier, configured in `.prettierrc.json` (100 columns, double
  quotes, ES5 trailing commas) with `.prettierignore` for build output.
  Run `npm run format` before pushing; CI runs `npm run format:check` and fails
  on drift.
- There is deliberately **no pre-commit hook.** The repo sets
  `ignore-scripts=true` in `.npmrc`, and the usual way to install a hook
  (husky) needs a `postinstall` script to do it — so the hook would either
  require weakening the install hardening or a manual `git config` step per
  clone. A previous `.lintstagedrc.json` here advertised commit-time
  formatting that never ran, because no hook was ever installed and nothing
  checked. CI gating is the control; a local hook is a convenience, not a
  guarantee.
- Match the existing structure: `src/core` (scalar abstraction), `src/range`,
  `src/range-map`.
- Prefer fixing things in the build over fixing them in the source. The sources
  should stay plain, modern TypeScript; target-specific quirks (like adding `.js`
  extensions to ESM relative imports) belong in `scripts/finalize-dist.mjs`.

## Proposing changes

- Open an issue before anything that changes the public API surface.
- Breaking changes are fine for a major version but must be listed in
  `CHANGELOG.md` under a `### Breaking` heading with the _reason_, not just the
  what.
- `CHANGELOG.md` follows Keep a Changelog conventions.

## Releasing

See [RELEASE.md](RELEASE.md). Note that releasing is a maintainer action and that
CI deliberately stops at "staged" — promotion requires a human with 2FA.
