import type { RefObject } from 'react';

import { useTranslation } from 'react-i18next';

import SearchRow from '../../common/SearchRow';
import { SCROLLBAR_WIDTH_VAR } from '../../../hooks/useScrollbarWidthVar';
import { ICON } from '../../../styles/scale';

// OpenNowWindow's ICON_SLOT: the glass sits in the window glyph's column.
const GLASS_INSET = `calc(${ICON.DEFAULT} + 8px)`;

interface OpenNowSearchRowProps {
  text: string;
  onTextChange: (text: string) => void;
  inputRef: RefObject<HTMLInputElement>;
  // ↓ in the field: the pane moves focus to the first tab drawn.
  onArrowDown: () => void;
  // Enter in the field: the pane decides whether it switches.
  onEnter: () => void;
}

export default function OpenNowSearchRow(props: OpenNowSearchRowProps) {
  const { t } = useTranslation();
  return (
    <SearchRow
      {...props}
      label={t('Search open tabs')}
      glassInset={GLASS_INSET}
      glassBox="column"
      textInset="8px"
      // KAN-336. The pane writes its list's bar width here: the × stays over the tab rows' ×.
      endInset={`var(${SCROLLBAR_WIDTH_VAR}, 0px)`}
      pane="openNow"
      emptyEscape="pass-on"
    />
  );
}
