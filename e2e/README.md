# End-to-end tests

`npm run test:e2e` typechecks these specs, builds the shippable artifact —
including the remote-code prune the release workflow applies — loads it into
Chromium as an unpacked extension, and drives the real popup.

```
npm run test:e2e
```

It always rebuilds first. That is deliberate: these tests run against a built
artifact, so a stale `dist/` would silently test the previous build.

It is not part of `npm test`, but CI runs it on every PR to `main`:
`.github/workflows/build_before_merge.yaml` splits the suite across shards, and
the required `Build before merge` check fails if any shard does. A docs-only PR
skips it (`scripts/docs_only.mjs`).

## Why a real browser

`service-worker.spec.ts` is the reason this harness exists. Everything in
`golden-path.spec.ts` is a popup-DOM assertion the jsdom component suite already
covers; the placeholder swap runs in the service worker (because the popup is
destroyed the moment a restored window takes focus) and cannot be expressed in
jsdom.

`a11y-controls.spec.ts` is the second thing jsdom cannot express.
`dom-accessibility-api`, which backs Testing Library's `getByRole(name:)`,
computes a name from an `aria-label` without applying the `generic`-role naming
prohibition, so a jsdom version of those assertions passes against the broken
code. Only a real accessibility tree can tell the two apart — see KAN-56.

## When something fails

```
npx playwright show-trace test-results/**/trace.zip
```

The trace carries DOM snapshots, console output and a per-step timeline. It is
the point of using Playwright here rather than a hand-rolled script — it makes
the manual chrome-devtools loop repeatable.

## What this cannot catch

- **Popup lifetime.** The popup is driven as a tab, because the real action
  popup closes the moment focus moves and cannot be automated. Defects that
  depend on the popup being destroyed are invisible here.
- **`visibilityState` / `hasFocus()`.** CDP forces tabs visible and focused,
  which real Chrome does not. Anything resting on those cannot be verified
  in this harness.
- **Sync on CI.** CI builds with no Firebase config, so every spec that needs
  the cloud skips there (`hasCloudConfig()`). Those specs run only locally,
  against the dev project, from a build that had `.env`.

## Notes for anyone extending it

All measured, not assumed — each cost a debugging cycle to find:

- **`channel: 'chromium'` is required.** Plain `headless: true` uses the
  headless _shell_, which never loads the extension: the service worker never
  registers and `waitForEvent('serviceworker')` times out.
- **`context.serviceWorkers()` is empty immediately after launch**, in every
  mode. Always await the `serviceworker` event; a bare `[0]` throws every run.
- **A placeholder tab must reach `status: 'complete'` before being activated**,
  or the in-flight `data:` navigation commits over the worker's rewrite. The
  listener fires either way, so this failure is silent.
- **Verify a mutation reached `dist/` before trusting a red or green run.**
  These tests exercise a built artifact, so a build that fails leaves the
  previous bundle in place and the run tells you nothing.
- **`testDir` in `playwright.config.ts` is load-bearing.** Playwright's default
  testDir is the repo root and its default match includes `.mjs`, so without it
  Playwright collects vitest files it cannot run.
- **CI shards split by measured time, one test at a time.** So no spec may run
  serially (a unit test checks). Refresh `shard-weights.json` from a green run:
  `gh run download <run-id> -p 'timings-shard-*'`, then
  `node scripts/e2e_shards.mjs timings-shard-*/results-shard-*.json`. A shard
  refuses to run when under half the tests have a weight, so a PR that renames
  most spec files renames their keys in `shard-weights.json` too.
- **`first-run-fit` checks five locales on a PR, all 13 before a release.** A PR
  that changes `package.json`'s version runs all 13 in CI, and
  `npm run test:e2e:langs` runs them locally.
