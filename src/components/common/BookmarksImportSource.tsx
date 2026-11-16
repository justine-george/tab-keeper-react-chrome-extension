import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';

import ImportSourceBlock from './ImportSourceBlock';
import {
  isNothingToImport,
  NOTHING_TO_IMPORT_TEXT,
  startBookmarkImport,
} from '../../redux/startBookmarkImport';
import type { NothingToImport } from '../../utils/functions/bookmarkImport';
import type { AppDispatch } from '../../redux/store';

// KAN-862. Setup's bookmarks block. Its button opens the import over setup; once something has come in
// since setup opened, the line says how much and the button offers more. A press that finds nothing left to
// import says so on the line: a toast would sit under setup (R23).
export default function BookmarksImportSource({
  importedInSetup,
}: {
  importedInSetup: number;
}) {
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();
  const hasImported = importedInSetup > 0;
  // What the last press found when it opened no dialog for want of anything to import.
  const [nothingLeft, setNothingLeft] = useState<NothingToImport | null>(null);

  return (
    <ImportSourceBlock
      line={
        nothingLeft !== null
          ? t(NOTHING_TO_IMPORT_TEXT[nothingLeft])
          : hasImported
            ? t('SessionsImportedInSetup', { count: importedInSetup })
            : t(
                'Turn bookmark folders into saved sessions. Your bookmarks stay as they are.'
              )
      }
      buttonLabel={hasImported ? t('Import more') : t('Import from bookmarks')}
      onPress={() =>
        void dispatch(startBookmarkImport()).then((start) =>
          setNothingLeft(isNothingToImport(start) ? start : null)
        )
      }
    />
  );
}
