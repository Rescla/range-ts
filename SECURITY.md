# Security Policy

## Reporting a vulnerability

**Please use [GitHub Private Vulnerability Reporting](https://github.com/Rescla/range-ts/security/advisories/new)**
rather than a public issue. This library is a dependency of other packages, so a
public report discloses the problem to every consumer at once.

You should get a response within 7 days. We will credit reporters unless you ask
not to be credited.

Please include: the affected version, a minimal reproduction, and what the actual
impact is (as distinct from the theoretical one).

## Supported versions

| Version | Supported                           |
| ------- | ----------------------------------- |
| 1.0.x   | ✅                                  |
| < 1.0   | ❌ — no backport capacity. Upgrade. |

This is a small, single-maintainer library. We cannot promise to patch old lines,
and we would rather say so than leave you assuming coverage that does not exist.

## Supply-chain posture

This section describes controls that are actually in place, and what each one does
and does not protect against.

### Install-time

- **`ignore-scripts=true`** (`.npmrc`) — no dependency lifecycle script runs on
  install. This closes the single most common npm supply-chain attack shape
  (`preinstall`/`install`/`postinstall` executing arbitrary code).
- **`min-release-age=7`** (`.npmrc`) — refuses to install package versions
  published less than 7 days ago, which is the window in which a typosquat or a
  hijacked-package version typically circulates before detection.
- **Dependabot with a matching 7-day cooldown** (`.github/dependabot.yml`) —
  automated update PRs are held to the same quarantine as the install gate, so
  the two controls do not fight each other. Covers both npm dependencies and the
  GitHub Actions in `.github/workflows`, which run with repo credentials and are
  therefore the higher-risk class.
- **No `--omit=optional` anywhere.** Not a security control but a correctness
  requirement: TypeScript 7's compiler is a platform-specific
  `optionalDependency`, so omitting optionals deletes the compiler.

### Package contents

- **`files` allowlist** — the tarball ships only `dist/cjs`, `dist/esm`,
  `dist/types`, README, LICENSE and CHANGELOG. Before it, publish shipped the repo
  minus `.gitignore`: `src/`, every tsconfig, and the `dist/karma` test artifacts
  (0.1.8: 81 files / 662 KiB unpacked). Verify rather than trusting this file —
  `npm pack --dry-run` for what this tree produces, `npm view range-ts
dist.fileCount` for what is live.
- **`exports` map blocks deep imports** — only `.` and `./package.json` resolve.
  This limits what a compromised _consumer_ of the package can reach into, and
  keeps internals reorganisable.
- **No runtime dependencies.** `dependencies` is empty. Installing `range-ts`
  adds no transitive packages to your tree. This is the strongest supply-chain
  property this library has.

### Build and release

- **CI runs CodeQL** on push and PR.
- **The release workflow has `contents: read`** — it cannot write to your repo.
- **CI ends at "staged".** No tag and no GitHub release are created by CI.
  Promotion requires a human with 2FA via `npm stage approve`.
- **`--provenance`** is used where the registry supports it, so the published
  artifact is cryptographically linked to this repository and workflow.

### What these controls do _not_ do

Being precise here matters more than listing badges:

- `ignore-scripts` protects the _install_ step. It does not protect against
  malicious code in a package that is already unpacked, nor against a compromised
  maintainer account.
- `min-release-age` delays adoption; it does not vet.
- CodeQL finds a subset of vulnerability classes and none in code it does not
  analyse.
- Tests and mutation score measure correctness of intended behaviour, not
  resistance to attack.

## Verified state

The claims above are checkable from this repository:

```bash
npm ci                          # observe: no lifecycle scripts run
cat .npmrc                      # the two controls
npm ls --all --prod 2>&1        # observe: no runtime dependencies
npm pack --dry-run              # observe: the file allowlist
```

## Note on this release

1.0.0 was produced with AI assistance. See the disclosure in
[README.md](README.md#about-this-release--ai-disclosure). It is relevant to
security review specifically: the review burden shifts toward the instrumentation,
which is why mutation testing and the three-environment test suite were built out
before this release rather than after.
