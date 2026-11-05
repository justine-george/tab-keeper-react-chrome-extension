import { css } from '@emotion/react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import { PuzzleGlyph } from '../../common/glyphs';
import { isDarkTheme } from '../../../hooks/useThemeColors';
import type { AppDispatch, RootState } from '../../../redux/store';
import { chooseToolbarIcon } from '../../../redux/toolbarIconChoice';
import { RADIUS } from '../../../styles/scale';
import type { ToolbarIcon } from '../../../utils/functions/toolbarIcon';
import SwatchButton from './SwatchButton';

// Chrome's own toolbars and the grey of their icons.
const DARK_TOOLBAR = '#3c3c3c';
const LIGHT_TOOLBAR = '#f1f3f4';
const ON_DARK_TOOLBAR = '#c7c7c7';
const ON_LIGHT_TOOLBAR = '#474747';

// 1x and 2x, so a tile draws the same pixels Chrome will.
const ICON_FILES: Record<ToolbarIcon, readonly [string, string]> = {
  colour: ['icons/icon16.png', 'icons/icon32.png'],
  light: ['icons/toolbar-light-16.png', 'icons/toolbar-light-32.png'],
  dark: ['icons/toolbar-dark-16.png', 'icons/toolbar-dark-32.png'],
};

const tileCss = css`
  align-items: center;
  justify-content: center;
  gap: 7px;
`;

const menuCss = css`
  display: grid;
  gap: 1.5px;
  flex-shrink: 0;
`;

const dotCss = css`
  width: 2px;
  height: 2px;
  border-radius: ${RADIUS.MARK};
  background-color: currentColor;
`;

// KAN-932. Each icon at its real size, in Chrome's order: pinned extensions, then
// the puzzle piece and the ⋮. Colour suits any toolbar, so it takes the theme's.
export default function ToolbarIconTiles({
  describedBy,
}: {
  describedBy: string;
}) {
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();
  const chosen = useSelector(
    (state: RootState) => state.settingsDataState.toolbarIcon
  );
  const isDark = useSelector((state: RootState) =>
    isDarkTheme(state.settingsDataState.theme)
  );

  const tile = (icon: ToolbarIcon, name: string) => {
    const onDarkToolbar = icon === 'light' || (icon === 'colour' && isDark);
    const [oneX, twoX] = ICON_FILES[icon];
    return (
      <SwatchButton
        key={icon}
        name={name}
        isActive={chosen === icon}
        onSelect={() => void dispatch(chooseToolbarIcon(icon))}
        background={onDarkToolbar ? DARK_TOOLBAR : LIGHT_TOOLBAR}
        tileCss={css`
          ${tileCss}
          color: ${onDarkToolbar ? ON_DARK_TOOLBAR : ON_LIGHT_TOOLBAR};
        `}
        describedBy={describedBy}
      >
        <img
          data-toolbar-part="icon"
          src={oneX}
          srcSet={`${oneX} 1x, ${twoX} 2x`}
          alt=""
          width={16}
          height={16}
        />
        <span data-toolbar-part="puzzle">
          <PuzzleGlyph size="15px" />
        </span>
        <span data-toolbar-part="menu" css={menuCss}>
          <i css={dotCss} />
          <i css={dotCss} />
          <i css={dotCss} />
        </span>
      </SwatchButton>
    );
  };

  return (
    <>
      {tile('colour', t('ToolbarIconColour'))}
      {tile('light', t('ToolbarIconLight'))}
      {tile('dark', t('ToolbarIconDark'))}
    </>
  );
}
