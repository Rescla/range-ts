<!--
Default docs for this repo. See also CONTRIBUTING.md and SECURITY.md.
-->

## What

Short description of the change.

## Was this AI-assisted?

This project discloses AI authorship of its 1.0.0 release (see the README). We
ask the same of contributions — it is not a penalty and it will not get your PR
rejected, but we would rather know than guess.

- [ ] No, written by hand
- [ ] AI-assisted (agent wrote some or all of it, I reviewed it)
- [ ] AI-generated, I have read and can defend every line

If assisted, say which tool and roughly what the split was.

## Verification

What did you run, and what was the result?

```
npm test
npm run test:mutation
```

- [ ] All three test environments pass
- [ ] Mutation score did not drop
- [ ] I checked that a new test actually fails without the change

## Breaking change?

- [ ] No
- [ ] Yes — documented under `### Breaking` in CHANGELOG.md with the _reason_

If yes: is everything still reachable from the package root? Deep imports are
blocked by the `exports` map, so a new public export must be added to `src/index.ts`.
