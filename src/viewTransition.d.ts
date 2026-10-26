// Same-document View Transitions (KAN-810): Chrome has them; TypeScript's DOM
// lib does not declare them yet. Optional, so a caller has to check.
interface ViewTransition {
  readonly finished: Promise<void>;
  readonly ready: Promise<void>;
  readonly updateCallbackDone: Promise<void>;
  skipTransition(): void;
}

interface Document {
  startViewTransition?(callback?: () => void | Promise<void>): ViewTransition;
}
