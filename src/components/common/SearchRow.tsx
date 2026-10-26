import type { KeyboardEvent, RefObject } from 'react';

import { css } from '@emotion/react';
import { useTranslation } from 'react-i18next';

import Icon from './Icon';
import { Tag } from './Tag';
import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import { NON_INTERACTIVE_ICON_STYLE } from '../../utils/constants/common';
import { ICON, TYPE } from '../../styles/scale';
import { placeholderStyle } from '../../styles/placeholder';
import { SEARCH_SHORTCUT_KEY, type SearchPane } from './searchShortcut';
import { useSearchTarget } from '../../hooks/useSearchShortcut';
import { focusRingCss } from './focusRing';

// The header's action row height (8px + CONTROL.ROW), then a 4px gap.
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
  // Whose search this is: it marks the row, and shows the / chip while / goes here (KAN-800).
  pane: SearchPane;
  // Without a handler the key keeps its default.
  onArrowDown?: () => void;
  onEnter?: () => void;
  // Esc in the empty field: 'leave-field' takes it and lets go of focus, as
  // nothing else does and Chrome closes the popup on it (KAN-684); 'pass-on'
  // leaves it to the pane, where it closes the Open now drawer (O2).
  emptyEscape: 'leave-field' | 'pass-on';
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
  pane,
  onArrowDown,
  onEnter,
  emptyEscape,
}: SearchRowProps) {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  const isShortcutTarget = useSearchTarget() === pane;
  const rowAttribute =
    pane === 'openNow' ? 'data-open-now-search' : 'data-saved-search';

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
      event.preventDefault();
      event.stopPropagation();
      onTextChange('');
    } else if (event.key === 'Escape' && emptyEscape === 'leave-field') {
      event.preventDefault();
      event.currentTarget.blur();
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
    /* KAN-671. The field has no box; the ring goes round its row. */
    ${focusRingCss(COLORS, '&:has(> input:focus-visible)')}
  `;

  const glassStyle = css`
    display: flex;
    margin-left: ${glassInset};
  `;

  // TextBox's colours, no box; selectable in a user-select: none list.
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
    ${placeholderStyle(COLORS.PLACEHOLDER_COLOR)}
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
        aria-keyshortcuts={isShortcutTarget ? SEARCH_SHORTCUT_KEY : undefined}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onTextChange(event.target.value)}
        onKeyDown={onKeyDown}
        css={inputStyle}
      />
      <span css={endSlotStyle}>
        {text === '' ? (
          isShortcutTarget && (
            // KAN-810. Moves with the / target as the saved session folds.
            <span aria-hidden="true" data-pane-layer="search-chip">
              <Tag value={SEARCH_SHORTCUT_KEY} />
            </span>
          )
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
