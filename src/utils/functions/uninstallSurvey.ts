// KAN-642. What Chrome opens after an uninstall: a Google Form asking why,
// stamped with version and language. Worker-safe; the worker is the only setter.
// KAN-643. Two copies of the form, differing only by image; each install keeps one.
import { startupLanguage, type Language } from './languages';

export const UNINSTALL_SURVEY_FORMS = {
  a: 'https://docs.google.com/forms/d/e/1FAIpQLSfkdlOu5hLRrU9Xa-bRRq-bIVDZHwybbqDaHYfHWdwqOLz9NQ/viewform',
  b: 'https://docs.google.com/forms/d/e/1FAIpQLSfoquF4VOaq-HITFlVMgNLdoq_V1w3UQcrrNuFIB4bzx5mEmg/viewform',
} as const;
export type UninstallSurveyForm = keyof typeof UNINSTALL_SURVEY_FORMS;
// Version and Language questions; B is a copy of A, so the ids match. Recreating a question in either form changes its id.
const VERSION_ENTRY = 'entry.289476948';
const LANGUAGE_ENTRY = 'entry.19370289';

// The page's language, mirrored to chrome.storage.local: the worker cannot read localStorage.
export const UNINSTALL_SURVEY_LANGUAGE_KEY = 'uninstallSurveyLanguage';
// This install's form, drawn once by the worker.
export const UNINSTALL_SURVEY_FORM_KEY = 'uninstallSurveyForm';

export function uninstallSurveyUrl(
  form: UninstallSurveyForm,
  version: string,
  language: Language
): string {
  const params = new URLSearchParams({
    usp: 'pp_url',
    [VERSION_ENTRY]: version,
    [LANGUAGE_ENTRY]: language,
  });
  return `${UNINSTALL_SURVEY_FORMS[form]}?${params.toString()}`;
}

const isUninstallSurveyForm = (value: unknown): value is UninstallSurveyForm =>
  typeof value === 'string' &&
  Object.keys(UNINSTALL_SURVEY_FORMS).includes(value);

export interface UninstallSurveyApi {
  setUninstallURL(url: string): Promise<void>;
  version(): string;
  uiLanguage(): string | undefined;
  // In [0, 1), like Math.random.
  random(): number;
}

export interface UninstallSurveyStore {
  readLanguage(): Promise<unknown>;
  readForm(): Promise<unknown>;
  writeForm(form: UninstallSurveyForm): Promise<void>;
}

// The stored form, or a fresh 50/50 draw stored for next time. Never rejects.
async function formForInstall(
  api: UninstallSurveyApi,
  store: UninstallSurveyStore
): Promise<UninstallSurveyForm> {
  try {
    const stored = await store.readForm();
    if (isUninstallSurveyForm(stored)) return stored;
  } catch (error) {
    console.warn('Could not read the uninstall survey form:', error);
  }
  const drawn: UninstallSurveyForm = api.random() < 0.5 ? 'a' : 'b';
  try {
    await store.writeForm(drawn);
  } catch (error) {
    console.warn('Could not store the uninstall survey form:', error);
  }
  return drawn;
}

// Never rejects: a survey must never break the extension. The URL set, or undefined.
export async function applyUninstallSurvey(
  api: UninstallSurveyApi,
  store: UninstallSurveyStore
): Promise<string | undefined> {
  let stored: unknown;
  try {
    stored = await store.readLanguage();
  } catch (error) {
    console.warn('Could not read the uninstall survey language:', error);
  }
  const form = await formForInstall(api, store);
  try {
    const url = uninstallSurveyUrl(
      form,
      api.version(),
      startupLanguage(stored, api.uiLanguage())
    );
    await api.setUninstallURL(url);
    return url;
  } catch (error) {
    console.warn('Could not set the uninstall survey:', error);
    return undefined;
  }
}

// One apply at a time, in call order, so an older read never lands last.
export function uninstallSurveyInOrder(
  api: UninstallSurveyApi,
  store: UninstallSurveyStore
): () => Promise<string | undefined> {
  let last: Promise<unknown> = Promise.resolve();
  return () => {
    const next = last.then(() => applyUninstallSurvey(api, store));
    last = next;
    return next;
  };
}

export interface UninstallSurveyArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

// The page's half. Never rejects; true when it wrote.
export async function mirrorUninstallSurveyLanguage(
  area: UninstallSurveyArea,
  language: Language
): Promise<boolean> {
  try {
    const items = await area.get(UNINSTALL_SURVEY_LANGUAGE_KEY);
    if (items[UNINSTALL_SURVEY_LANGUAGE_KEY] === language) return false;
    await area.set({ [UNINSTALL_SURVEY_LANGUAGE_KEY]: language });
    return true;
  } catch (error) {
    console.warn(
      'Could not mirror the language for the uninstall survey:',
      error
    );
    return false;
  }
}
