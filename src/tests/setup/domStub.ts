// src/utils/constants/common.ts reads window.screen.height at module load, so
// importing any Redux slice under vitest's node environment throws
// `ReferenceError: window is not defined` without this.
//
// Callers must inline this assignment inside their own vi.hoisted() block
// rather than importing this function into one: ES imports are hoisted but not
// evaluated ahead of the module graph, so an imported helper is not available
// early enough. This module exists for the non-hoisted call and to keep the
// stub shape defined in exactly one place.
export function stubDomGlobals(): void {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
}
