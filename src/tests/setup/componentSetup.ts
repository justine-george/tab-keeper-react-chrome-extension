import { vi } from 'vitest';

import '@testing-library/jest-dom/vitest';

// Every component test needs this stubbed: utils/functions/external reaches
// out to Firestore and chrome.notifications, none of which exist in jsdom.
// Centralized here (rather than copy-pasted per test file) so a new
// component test file cannot forget it -- on CI, where no .env exists, an
// unmocked import of this module throws at module-load time, so the hazard
// is invisible on a machine that has one.
vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
  displayToast: vi.fn(),
}));
