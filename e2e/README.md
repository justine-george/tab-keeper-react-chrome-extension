# End-to-end tests

`npm run test:e2e` typechecks these specs, builds the shippable artifact —
including the remote-code prune the release workflow applies — loads it into
Chromium as an unpacked extension, and drives the real popup.

```
npm run test:e2e
```

It always rebuilds first. That is deliberate: these tests run against a built
artifact, so a stale `dist/` would silently test the previous build.

Deliberately manual. It is not part of `npm test` and no CI job runs it.

## What is covered

- `golden-path.spec.ts` — the popup renders, seeded sessions list, selecting
  one shows its details, the open-in-window control is enabled, search
  filters, and the settings panel opens and closes.
- `service-worker.spec.ts` — the lazy-load placeholder swap, and that the
  worker's listeners are registered at all.
- `a11y-controls.spec.ts` — the header affordances are exposed as named
  buttons and are operable by Enter and Space, and presentational icons stay
  out of the accessibility tree.

The service-worker spec is the reason this harness exists. Everything in the
golden path is a popup-DOM assertion the jsdom component suite already covers;
the placeholder swap runs in the service worker (because the popup is destroyed
the moment a restored window takes focus) and cannot be expressed in jsdom.

The a11y spec is the second thing jsdom cannot express. `dom-accessibility-api`,
which backs Testing Library's `getByRole(name:)`, computes a name from an
`aria-label` without applying the `generic`-role naming prohibition, so a jsdom
version of those assertions passes against the broken code. Only a real
accessibility tree can tell the two apart — see KAN-56.

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
- **Sync.** Runs are signed-out; nothing about Firestore is covered.

## Notes for anyone extending it

All measured, not assumed — each cost a debugging cycle to find:

- **`channel: 'chromium'` is required.** Plain `headless: true` uses the
  headless *shell*, which never loads the extension: the service worker never
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
