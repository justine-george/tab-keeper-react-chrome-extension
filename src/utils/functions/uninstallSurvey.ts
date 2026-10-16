// KAN-642. What Chrome opens after an uninstall: a Google Form asking why,
// stamped with version and language. Worker-safe; the worker is the only setter.
import { startupLanguage, type Language } from './languages';

export const UNINSTALL_SURVEY_FORM =
  'https://docs.google.com/forms/d/e/1FAIpQLSfkdlOu5hLRrU9Xa-bRRq-bIVDZHwybbqDaHYfHWdwqOLz9NQ/viewform';
// The form's Version and Language questions. Recreating either in Forms changes its id.
const VERSION_ENTRY = 'entry.289476948';
const LANGUAGE_ENTRY = 'entry.19370289';

// The page's language, mirrored to chrome.storage.local: the worker cannot read localStorage.
export const UNINSTALL_SURVEY_LANGUAGE_KEY = 'uninstallSurveyLanguage';

export function uninstallSurveyUrl(
  version: string,
  language: Language
): string {
  const params = new URLSearchParams({
    usp: 'pp_url',
    [VERSION_ENTRY]: version,
    [LANGUAGE_ENTRY]: language,
  });
  return `${UNINSTALL_SURVEY_FORM}?${params.toString()}`;
}

export interface UninstallSurveyApi {
  setUninstallURL(url: string): Promise<void>;
  version(): string;
  uiLanguage(): string | undefined;
}

export interface UninstallSurveyStore {
  read(): Promise<unknown>;
}

// Never rejects: a survey must never break the extension. The URL set, or undefined.
export async function applyUninstallSurvey(
  api: UninstallSurveyApi,
  store: UninstallSurveyStore
): Promise<string | undefined> {
  let stored: unknown;
  try {
    stored = await store.read();
  } catch (error) {
    console.warn('Could not read the uninstall survey language:', error);
  }
  try {
    const url = uninstallSurveyUrl(
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
