import type { KeyboardEvent, RefObject } from 'react';

import { css } from '@emotion/react';
import { useTranslation } from 'react-i18next';

import Icon from '../../common/Icon';
import { Tag } from '../../common/Tag';
import { useFontFamily } from '../../../hooks/useFontFamily';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { NON_INTERACTIVE_ICON_STYLE } from '../../../utils/constants/common';
import { ICON, TYPE } from '../../../styles/scale';

// KAN-330 O14d E: the header's action row height (8px + CONTROL.ROW), with
// 4px of space under the divider before the first window row.
const ROW_HEIGHT = '40px';
const ROW_GAP = '4px';
// OpenNowWindow's ICON_SLOT: an Icon's box. rem-based, so it follows
// Chrome's font size (KAN-312) as the window row's columns do.
const ICON_SLOT = `calc(${ICON.DEFAULT} + 8px)`;

interface OpenNowSearchRowProps {
  text: string;
  onTextChange: (text: string) => void;
  inputRef: RefObject<HTMLInputElement>;
  // ↓ in the field (O14b): the pane moves focus to the first tab drawn.
  onArrowDown: () => void;
  // Enter in the field (O14b): the pane decides whether it switches.
  onEnter: () => void;
}

// KAN-330 P2a. Built on the list's own columns so it reads as the list's
// first row: the glass in the window glyph's column, the text in the title
// column, the clear × where a tab row's × sits, and the row divider under it.
export default function OpenNowSearchRow({
  text,
  onTextChange,
  inputRef,
  onArrowDown,
  onEnter,
}: OpenNowSearchRowProps) {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      onArrowDown();
    } else if (event.key === 'Enter') {
      onEnter();
    } else if (event.key === 'Escape' && text !== '') {
      // With text, Esc is the field's: it clears and the drawer stays open.
      // Empty, it passes on, and the drawer closes as it always has (O2).
      event.preventDefault();
      event.stopPropagation();
      onTextChange('');
    }
  };

  const clear = () => {
    onTextChange('');
    inputRef.current?.focus();
  };

  const rowStyle = css`
    display: flex;
    align-items: center;
    flex-shrink: 0;
    height: ${ROW_HEIGHT};
    margin-bottom: ${ROW_GAP};
    border-bottom: 1px solid ${COLORS.DIVIDER_COLOR};
    font-family: ${FONT_FAMILY};
  `;

  // One chevron slot in, so the glass sits in the window glyph's column.
  const glassStyle = css`
    display: flex;
    margin-left: ${ICON_SLOT};
  `;

  // TextBox's colours (KAN-205), no box: the list box is the frame. The 8px
  // puts the text in the title column (the window title's padding-left).
  // user-select: the pane's list sets none, and an input must stay selectable.
  const inputStyle = css`
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 0 0 8px;
    border: none;
    outline: none;
    background: transparent;
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.BODY};
    color: ${COLORS.LABEL_L1_COLOR};
    text-overflow: ellipsis;
    user-select: text;
    &::placeholder {
      color: ${COLORS.LABEL_L3_COLOR};
    }
  `;

  // The row's right-edge slot, where a tab row's × sits.
  const endSlotStyle = css`
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: ${ICON_SLOT};
  `;

  return (
    <div css={rowStyle} data-open-now-search>
      <span css={glassStyle}>
        <Icon type="search" style={NON_INTERACTIVE_ICON_STYLE} />
      </span>
      <input
        ref={inputRef}
        type="text"
        value={text}
        placeholder={t('Search open tabs')}
        aria-label={t('Search open tabs')}
        aria-keyshortcuts="/"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onTextChange(event.target.value)}
        onKeyDown={onKeyDown}
        css={inputStyle}
      />
      <span css={endSlotStyle}>
        {text === '' ? (
          <span aria-hidden="true">
            <Tag value="/" />
          </span>
        ) : (
          <Icon
            tooltipText={t('Clear search')}
            ariaLabel={t('Clear search')}
            type="close"
            onClick={clear}
          />
        )}
      </span>
    </div>
  );
}
