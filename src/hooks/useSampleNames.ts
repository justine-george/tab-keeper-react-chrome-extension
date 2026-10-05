import { useTranslation } from 'react-i18next';

import type { SampleNames } from '../utils/functions/sampleSession';

// The sample's names in the language on screen; tab titles stay English.
export function useSampleNames(): SampleNames {
  const { t } = useTranslation();
  return {
    title: t('Sample: Weekend trip'),
    gettingThere: t('Getting there'),
    thingsToDo: t('Things to do'),
  };
}
