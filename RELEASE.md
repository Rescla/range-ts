# Release process

A release is four separate artifacts that must agree: the **npm package**, the
**git tag**, the **GitHub release**, and the **CHANGELOG**. Doing three of four is
how you get a tag pointing at a version that never shipped, or a changelog that
claims a release that isn't on the registry.

## Prerequisites (one-time, account-side)

The publish step needs one of these configured on npmjs.com for this package:

1. **`NPM_AUTH_TOKEN`** — a granular access token scoped to publish `range-ts`,
   stored as a GitHub Actions secret on the repo. This is what the workflow uses
   today.
2. **Trusted publishing (preferred once set up)** — OIDC from this repo, no
   long-lived token. Requires npm ≥ 11.5.1 and Node ≥ 22.14.0. CI runs Node 26
   (current LTS), whose bundled npm 11.20.0 already clears both, so no npm
   upgrade step is needed. Once configured in the npm UI (repo `Rescla/range-ts`,
   workflow `.github/workflows/release.yml`), `NPM_AUTH_TOKEN` can be deleted.

Without either, the publish step fails with `ENEEDAUTH` and nothing else in the
release happens. `npm whoami` returning `ENEEDAUTH` on a workstation is expected;
publishing happens in CI.

## Steps

### 1. Prepare (local, committed before the release is cut)

```bash
# a. version
npm version 1.0.0 --no-git-tag-version   # or edit package.json directly

# b. CHANGELOG: give the entry the release date
#    "## [1.0.0] - Unreleased"  ->  "## [1.0.0] - 2026-11-01"

# c. resync the lockfile — it carries the version field
npm install --package-lock-only

# d. everything green
npm test

# e. commit and push. One commit per version bump.
git add package.json package-lock.json CHANGELOG.md
git commit -m "Release 1.0.0"
git push origin master
```

Step (c) is not optional. `package-lock.json` stores the package's own version in
`packages[""].version`; a lockfile pinned to the previous version is a claim
about the code that the next `npm install` propagates silently. This was actually
missed once: `package.json` said `1.0.0`, the lockfile said `0.1.8`, and CI still
passed — `npm ci` does not check the root version field.

### 2. Publish (CI, one manual dispatch)

Actions → **Release** → Run workflow → uncheck dry-run.

The workflow does, in order:

| Step | Why it is where it is |
|---|---|
| Show toolchain | Logs the exact node/npm that produced the artifact and attestation, instead of leaving it inferred from the runner image |
| `npm ci` + `npm run build` | build runs the full suite, so a red test stops before publish |
| Refuse if version exists | publishing over an existing version fails mid-flow and strands the tag |
| `npm publish --provenance --access public` | the actual publish |
| Verify from the registry | reads back version, tarball URL, integrity, file count |
| Tag `v<version>` and push | the git-side assertion |
| `gh release create` with the changelog section | notes are extracted from CHANGELOG.md so the two cannot disagree |

Run it with `dry_run: true` first the first time to exercise everything except the
publish and the tag push.

### 3. Verify (after the dispatch)

```bash
npm view range-ts version          # -> the new version
npm view range-ts dist.tarball     # -> tarball URL
git tag -l 'v*' | tail -3         # -> tag present
```

Plus: the GitHub release exists with notes, and `npm audit` on a fresh consumer
install resolves cleanly.

## Rollback

npm does not unpublish cleanly — the version stays reserved for 24h and is
discouraged after 72h. The preferred rollback is **forward**: fix forward and
publish the next patch. If a version must be pulled, deprecate it rather than
delete it:

```bash
npm deprecate "range-ts@1.0.0" "broken: <reason>"
```

That leaves the package installable but warns everyone, which is recoverable.
Deleting is not.

## Notes on this repo's specifics

- **Do not add `--omit=optional` to any install here.** TypeScript 7 ships its
  compiler as a platform-specific optionalDependency; omitting optionals deletes
  the compiler. See the comment in `main.yml`.
- **`ignore-scripts=true` and `min-release-age=7`** in `.npmrc` apply to the
  publish build too. They are compatible with publishing: the native TS packages
  are prebuilt binaries needing no install script.
- **The tarball is allowlisted** by `files` in `package.json`
  (`dist/cjs`, `dist/esm`, `dist/types`, README, LICENSE, CHANGELOG). Before the
  allowlist, `npm publish` shipped 469 files / 14.2 MB including every tsconfig
  and `tsconfig.tsbuildinfo`. Check `dist.fileCount` in the verify step rather
  than trusting it stayed fixed.
- **Code Climate is gone.** The test reporter is archived
  (`qltysh-archive/test-reporter`) and its download URLs 404. Coverage lives in
  the local istanbul and Stryker reports only.
