import { useEffect } from 'react';
import { useSelector } from 'react-redux';

import type { RootState } from '../redux/store';
import { mirrorUninstallSurveyLanguage } from '../utils/functions/uninstallSurvey';

// KAN-642. Mirrors the resolved language, not the pick, so every path that changes it is covered.
export function useUninstallSurveyLanguage(): void {
  const language = useSelector((s: RootState) => s.settingsDataState.language);

  useEffect(() => {
    const area =
      typeof chrome === 'undefined' ? undefined : chrome.storage?.local;
    if (area === undefined) return;
    void mirrorUninstallSurveyLanguage(area, language);
  }, [language]);
}
