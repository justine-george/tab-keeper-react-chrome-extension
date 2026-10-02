import type { KeyboardEvent, RefObject } from 'react';

import { css } from '@emotion/react';
import { useTranslation } from 'react-i18next';

import Icon from './Icon';
import { Tag } from './Tag';
import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import { NON_INTERACTIVE_ICON_STYLE } from '../../utils/constants/common';
import { ICON, TYPE } from '../../styles/scale';
import { SEARCH_SHORTCUT_KEY } from '../home/opennow/searchShortcut';

// The header's action row height (8px + CONTROL.ROW), with 4px of space
// under the divider before the first row.
const ROW_HEIGHT = '40px';
const ROW_GAP = '4px';
// An Icon's box. rem-based, so it follows Chrome's font size as rows do.
const ICON_SLOT = `calc(${ICON.DEFAULT} + 8px)`;

interface SearchRowProps {
  text: string;
  onTextChange: (text: string) => void;
  inputRef: RefObject<HTMLInputElement>;
  // Placeholder and aria-label, already translated.
  label: string;
  // The magnifier box's margin-left.
  glassInset: string;
  // 'column': ICON.SMALL centred in an ICON.DEFAULT box. 'tight': ICON.SMALL, no box.
  glassBox: 'column' | 'tight';
  // The input's padding-left.
  textInset: string;
  rowAttribute: 'data-open-now-search' | 'data-saved-search';
  // Without a handler the key keeps its default.
  onArrowDown?: () => void;
  onEnter?: () => void;
}

// A search field laid out as a list's first row, over the list's own columns.
export default function SearchRow({
  text,
  onTextChange,
  inputRef,
  label,
  glassInset,
  glassBox,
  textInset,
  rowAttribute,
  onArrowDown,
  onEnter,
}: SearchRowProps) {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // While an IME composes a word, its keys are the IME's: the Enter that
    // confirms the word, the arrows that pick a candidate, the Esc that
    // cancels it. Measured in Chromium, each arrives here with isComposing
    // true, and acted on it switched Chrome to a tab, took focus out of the
    // field mid-word, and emptied the field. Stopped as well, so the
    // drawer's Esc (O2) does not close around a word being cancelled.
    if (event.nativeEvent.isComposing) {
      event.stopPropagation();
      return;
    }
    if (event.key === 'ArrowDown' && onArrowDown) {
      event.preventDefault();
      onArrowDown();
    } else if (event.key === 'Enter' && onEnter) {
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

  const glassStyle = css`
    display: flex;
    margin-left: ${glassInset};
  `;

  // TextBox's colours, no box: the list box is the frame. user-select: the pane's list sets none, and an input must stay selectable.
  const inputStyle = css`
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 0 0 ${textInset};
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
    <div css={rowStyle} {...{ [rowAttribute]: '' }}>
      <span css={glassStyle}>
        {glassBox === 'column' ? (
          <Icon
            type="search"
            size={ICON.SMALL}
            boxSizedFor={ICON.DEFAULT}
            style={NON_INTERACTIVE_ICON_STYLE}
          />
        ) : (
          <Icon
            type="search"
            size={ICON.SMALL}
            style={`padding: 0; ${NON_INTERACTIVE_ICON_STYLE}`}
          />
        )}
      </span>
      <input
        ref={inputRef}
        type="text"
        value={text}
        placeholder={label}
        aria-label={label}
        aria-keyshortcuts={SEARCH_SHORTCUT_KEY}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onTextChange(event.target.value)}
        onKeyDown={onKeyDown}
        css={inputStyle}
      />
      <span css={endSlotStyle}>
        {text === '' ? (
          <span aria-hidden="true">
            <Tag value={SEARCH_SHORTCUT_KEY} />
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
