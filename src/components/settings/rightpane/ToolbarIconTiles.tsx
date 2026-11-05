import { css } from '@emotion/react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import { PuzzleGlyph } from '../../common/glyphs';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import type { AppDispatch, RootState } from '../../../redux/store';
import { chooseToolbarIcon } from '../../../redux/toolbarIconChoice';
import type { ToolbarIcon } from '../../../utils/functions/toolbarIcon';
import { RADIUS } from '../../../styles/scale';
import SwatchButton from './SwatchButton';

// Chrome's own toolbars and the grey of their icons.
const DARK_TOOLBAR = '#3c3c3c';
const LIGHT_TOOLBAR = '#f1f3f4';
const ON_DARK_TOOLBAR = '#c7c7c7';
const ON_LIGHT_TOOLBAR = '#474747';

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

// KAN-932, KAN-933. Each icon at its real size in Chrome's order: pinned extensions,
// then the puzzle piece and the ⋮, on a toolbar of Chrome's own mode.
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
  const isChromeDark = useMediaQuery('(prefers-color-scheme: dark)');

  const tile = (icon: ToolbarIcon, name: string, file: string) => (
    <SwatchButton
      name={name}
      isActive={chosen === icon}
      onSelect={() => void dispatch(chooseToolbarIcon(icon))}
      background={isChromeDark ? DARK_TOOLBAR : LIGHT_TOOLBAR}
      tileCss={css`
        ${tileCss}
        color: ${isChromeDark ? ON_DARK_TOOLBAR : ON_LIGHT_TOOLBAR};
      `}
      describedBy={describedBy}
    >
      {/* 1x and 2x, so a tile draws the same pixels Chrome will. */}
      <img
        data-toolbar-part="icon"
        src={`icons/${file}16.png`}
        srcSet={`icons/${file}16.png 1x, icons/${file}32.png 2x`}
        alt=""
        width={16}
        height={16}
      />
      <span data-toolbar-part="puzzle">
        <PuzzleGlyph size="17px" />
      </span>
      <span data-toolbar-part="menu" css={menuCss}>
        <i css={dotCss} />
        <i css={dotCss} />
        <i css={dotCss} />
      </span>
    </SwatchButton>
  );

  return (
    <>
      {tile('colour', t('ToolbarIconColour'), 'icon')}
      {tile(
        'monochrome',
        t('ToolbarIconMonochrome'),
        isChromeDark ? 'toolbar-light-' : 'toolbar-dark-'
      )}
    </>
  );
}
