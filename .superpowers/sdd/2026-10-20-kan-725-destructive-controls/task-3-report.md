# Task 3 report: dialog confirms

Implemented `danger` in src/components/modals/dialogButtons.ts: DANGER_FILL border and ground, ON_DANGER_FILL ink, hover DEEP, press DEEPER (border and ground together, both in the transition), ring from `focusRingInInkCss()` placed after `${base}` so it wins over base's TEXT_COLOR ring. Header comment's KAN-204 sentence rewritten.

Tests (src/tests/components/dialogButtonPress.test.tsx): removed the isDanger exception; new describe "the danger confirm (KAN-725)" with rest colours, hover/press rules, transition, and ring (currentColor, -4px, not TEXT_COLOR).

RED: `npx vitest run src/tests/components/dialogButtonPress.test.tsx` -> 5 failed | 10 passed (old danger: rgb(224,148,148) rest, hover == active, no border rung, base ring). GREEN: same command plus deleteCloudData and dialogEscape specs -> 43 passed, exit 0.
Revert evidence: old dialogButtons.ts restored -> 5 failed | 10 passed; new restored.
tsc --noEmit exit 0; eslint exit 0; prettier applied.
`npm test` exit 0: 553 files passed, 6648 passed | 1 expected fail.
Files: dialogButtons.ts, dialogButtonPress.test.tsx.
Concerns: none. Hover/active asserted via hoverRules helpers; no browser run of the real dialog (e2e not run).
