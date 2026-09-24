import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { isTabView } from '../utils/functions/viewMode';

/**
 * KAN-279/KAN-301. The tab view is a real browser tab, so its title shows
 * in the tab strip and window switcher; the popup's <title> (index.html,
 * never visible) says nothing about that. This sets document.title to the
 * app name -- the same key the header renders (t('Tab Keeper')) -- so the
 * tab reads as the app rather than as a blank "index.html".
 *
 * Only runs in the tab view: `isTabView()` gates the effect, so the popup's
 * own <title> is left exactly as it was.
 */
export function useDocumentTitle(): void {
  const { t } = useTranslation();

  useEffect(() => {
    if (!isTabView()) return;
    document.title = t('Tab Keeper');
  }, [t]);
}
