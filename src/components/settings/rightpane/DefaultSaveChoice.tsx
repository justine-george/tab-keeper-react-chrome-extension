import { useId } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import Icon from '../../common/Icon';
import { whileKeyNav } from '../../common/focusRing';
import { SAVE_OF } from '../../home/leftpane/saveScopes';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useFontFamily } from '../../../hooks/useFontFamily';
import { AppDispatch, RootState } from '../../../redux/store';
import { setDefaultSaveScope } from '../../../redux/slices/settingsDataStateSlice';
import { visuallyHiddenStyle } from '../../../styles/visuallyHidden';
import { TYPE, WEIGHT } from '../../../styles/scale';
import type { CaptureScope } from '../../../utils/functions/capture';
import { useTranslation } from 'react-i18next';

const CHOICES: readonly { scope: CaptureScope; word: string }[] = [
  { scope: 'all-windows', word: 'All windows' },
  { scope: 'current-window', word: 'Current window' },
];

/**
 * KAN-635. Default save: each choice drawn as the home save box would be with
 * it -- the save's glyph in the 58px square, ⋮ in the 28px strip -- and the
 * chosen one ringed outside the box, so the box itself stays as on home.
 *
 * Native radios inside labels: the whole tile and its word are one click
 * target, and the browser gives one tab stop and arrow keys. The ⋮ is a
 * drawing here; nothing opens.
 */
export default function DefaultSaveChoice({
  describedBy,
}: {
  describedBy: string;
}) {
  const { t } = useTranslation();
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const dispatch: AppDispatch = useDispatch();
  const chosen = useSelector(
    (state: RootState) => state.settingsDataState.defaultSaveScope
  );
  const name = useId();

  const groupStyle = css`
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    /* Room for the 5px ring, which draws outside the tile. */
    padding: 5px;
    margin: -5px;
  `;
  const choiceStyle = css`
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.SECONDARY};
    color: ${COLORS.LABEL_L1_COLOR};
  `;
  // The home save group's box: UserInputContainer's saveGroupStyle, Button and trigger widths.
  const tileStyle = (isChosen: boolean) => css`
    position: relative;
    display: flex;
    height: 58px;
    border: 1px solid ${COLORS.CONTROL_BORDER_COLOR};
    /* KAN-675. Chosen: its own frame, 2px of LABEL_L2. Not TEXT_COLOR, which
       is the focus ring's (ThemeSwatch's rule); the second pixel is an inset
       shadow, so the tile keeps its width and its neighbour never moves. */
    ${
      isChosen &&
      `border-color: ${COLORS.LABEL_L2_COLOR}; box-shadow: inset 0 0 0 1px ${COLORS.LABEL_L2_COLOR};`
    }
  `;
  const squareStyle = css`
    display: grid;
    place-items: center;
    width: 58px;
  `;
  // Flex, as home's trigger: the 32px ⋮ box overflows the strip evenly; grid's auto column grew right (KAN-647).
  const dotsStyle = css`
    display: flex;
    justify-content: center;
    align-items: center;
    width: 28px;
    border-left: 1px solid ${COLORS.CONTROL_BORDER_COLOR};
  `;
  // The app's focus ring, 2px and 4px inside, drawn on the tile the radio stands for.
  const focusStyle = css`
    ${whileKeyNav('&:has(input:focus-visible) [data-tile]::after')} {
      content: '';
      position: absolute;
      inset: 3px;
      border: 2px solid ${COLORS.TEXT_COLOR};
      pointer-events: none;
    }
  `;
  // KAN-801. The word is stacked on a hidden bold copy of itself, so its column is always the bold width and choosing never moves the centred tile.
  const wordStyle = (isChosen: boolean) => css`
    display: grid;
    justify-items: center;
    & > * {
      grid-area: 1 / 1;
    }
    ${isChosen && `color: ${COLORS.TEXT_COLOR}; font-weight: ${WEIGHT.CHOSEN};`}
  `;
  const reservedStyle = css`
    visibility: hidden;
    font-weight: ${WEIGHT.CHOSEN};
  `;

  return (
    <div
      role="radiogroup"
      aria-label={t('Default save')}
      aria-describedby={describedBy}
      css={groupStyle}
    >
      {CHOICES.map(({ scope, word }) => {
        const isChosen = scope === chosen;
        return (
          <label key={scope} css={[choiceStyle, focusStyle]}>
            <input
              type="radio"
              name={name}
              value={scope}
              checked={isChosen}
              onChange={() => dispatch(setDefaultSaveScope(scope))}
              css={visuallyHiddenStyle}
            />
            <span data-tile="" css={tileStyle(isChosen)}>
              <span css={squareStyle}>
                <Icon type={SAVE_OF[scope].icon} />
              </span>
              <span css={dotsStyle}>
                <Icon type="more_vert" />
              </span>
            </span>
            <span css={wordStyle(isChosen)}>
              <span>{t(word)}</span>
              <span aria-hidden="true" css={reservedStyle}>
                {t(word)}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
