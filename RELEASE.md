# Release process

A release is four artifacts that must agree: the **npm package**, the **git tag**,
the **GitHub release**, and the **CHANGELOG**. Doing three of four is how you get
a tag pointing at a version that never shipped.

With staged publishing there is a fifth state in between: **staged but not
approved**. The process is built so that state can never acquire a git tag.

## Why staged, not `npm publish`

npm is restricting tokens that bypass 2FA for direct publishing. The registry
returns the notice: *"npm tokens that bypass 2FA are being restricted for account
changes and direct publishing"* (`gh.io/npm-gat-bypass2fa-deprecation`). A CI
job cannot answer a 2FA challenge, so `npm publish` from CI is being closed off —
which is what broke the first real release attempt.

Staged publishing is the sanctioned shape:

- `npm stage publish` — **no 2FA required**. CI can do this.
- `npm stage approve <id>` — **2FA required**. A human must do this.

That split is not an inconvenience to work around; it is the security property.
The human is the point.

Requires npm CLI ≥ 11.15.0 and Node ≥ 22.14.0. CI runs Node 26 (current LTS),
which bundles npm 11.20.0.

## Flow

```
CI: stage  ──►  human: approve (2FA)  ──►  CI: promote (tag + GitHub release)
```

### 1. Prepare (local, committed before anything is staged)

```bash
# a. version
npm version 1.0.0 --no-git-tag-version

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
`packages[""].version`; a lockfile pinned to the previous version is a claim about
the code that the next `npm install` propagates silently. This was actually missed
once: `package.json` said `1.0.0`, the lockfile said `0.1.8`, and CI still passed
— `npm ci` does not check the root version field.

### 2. Stage (CI, `mode=stage`)

Actions → **Release** → mode `stage`.

Builds, tests, then `npm stage publish --access public --provenance`. The job
reports the **stage id** and the exact approve command in the run summary.

It deliberately does **not** tag and does **not** open a GitHub release: the
package is not installable yet and could still be rejected.

Useful review commands once staged:

```bash
npm stage list "range-ts@1.0.0" --json   # find the stage id
npm stage view <stage-id>               # metadata
npm stage download <stage-id>           # pull the tarball and inspect it
```

### 3. Approve (human, 2FA — cannot be automated)

```bash
npm stage approve <stage-id>            # prompts for 2FA, publishes live
```

Or the **Staged Packages** tab on npmjs.com.

To back out instead: `npm stage reject <stage-id>` removes it from staging. Nothing
was published, so nothing needs unpublishing.

### 4. Promote (CI, `mode=promote`)

Re-dispatch with mode `promote`. It first verifies the version is actually live on
the public registry — which is proof a human approved it — and only then:

- tags `v<version>` and pushes
- opens the GitHub release with notes extracted from `CHANGELOG.md`

If the version is not live, the job fails rather than tagging something nobody can
install.

## Verifying

```bash
npm view range-ts version          # the new version
npm view range-ts dist.tarball     # tarball URL
npm view range-ts dist.fileCount   # 55 — see the allowlist note below
git tag -l 'v*' | tail -3         # tag present
```

## Rollback

npm does not unpublish cleanly — the version stays reserved for 24h and is
discouraged after 72h. Prefer moving forward. If a version must be pulled,
deprecate rather than delete:

```bash
npm deprecate "range-ts@1.0.0" "broken: <reason>"
```

Deprecation leaves the package installable but warns everyone, which is
recoverable. Deleting is not.

If the package is still only **staged**, rollback is trivial: `npm stage reject`.

## Repo-specific notes

- **Never pass a package-spec to `npm stage publish`.** `npm stage publish range-ts`
  resolves the name against the *registry*, not the working directory, and fails
  with "You cannot publish over the previously published versions". Publish the
  current directory by passing nothing (or `.`).
- **Do not add `--omit=optional` to any install here.** TypeScript 7 ships its
  compiler as a platform-specific optionalDependency; omitting optionals deletes
  the compiler. See the comment in `main.yml`.
- **`ignore-scripts=true` and `min-release-age=7`** in `.npmrc` apply to the
  release build too. Compatible with publishing: the native TS packages are
  prebuilt binaries needing no install script.
- **The tarball is allowlisted** by `files` in `package.json`
  (`dist/cjs`, `dist/esm`, `dist/types`, README, LICENSE, CHANGELOG). Before the
  allowlist, publish shipped 469 files / 14.2 MB including every tsconfig and
  `tsconfig.tsbuildinfo`. Check `dist.fileCount` rather than trusting it held.
- **Code Climate is gone.** The test reporter is archived
  (`qltysh-archive/test-reporter`) and its download URLs 404. Coverage lives in
  the local istanbul and Stryker reports only.
