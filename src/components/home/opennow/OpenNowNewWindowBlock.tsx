// KAN-815. The New window block below Currently open's last window, drawn
// while a saved carry can open here: a release in it opens a new window. To the drag engine it is a window of both lists (data-drop-window-id,
// a trailing block: isTrailingBlock), and a carried tab's or group's phantom
// rests in it, so the list adopts it there and nothing above moves. A window
// carry rests nowhere: the block is only the box that lights, pinned to the
// bottom of the visible list, since it lands anywhere (KAN-855). Mirrors the
// saved pane's trailing block (WindowEntryContainer, NEW_LAST_WINDOW), drawn
// only while lit (demo D4, his pick): unlit it is a blank row, so rows a gap
// above pushes down never land on its label.
import { css } from '@emotion/react';
import { useTranslation } from 'react-i18next';

import { DropBoxLabel } from '../../common/dropBox';
import { dropBoxStyle } from '../../common/dropBoxStyle';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { CONTROL } from '../../../styles/scale';
import {
  DraggableRow,
  PhantomRestingSlot,
} from '../rightpane/rowDrag/RowDragArea';
import { OPEN_NOW_LAST_TARGET } from '../rightpane/newWindowTarget';
import { OPEN_NOW_NEW_WINDOW } from './carriedIntoOpenNow';
import { OPEN_ITEMS_SCOPE, OPEN_TABS_SCOPE } from './useOpenNowDrop';

interface Props {
  // The phantom's row and the list that drags it; null for a window carry.
  phantom: { rowId: string; kind: 'tab' | 'group' } | null;
}

export default function OpenNowNewWindowBlock({ phantom }: Props) {
  const COLORS = useThemeColors();
  const { t } = useTranslation();
  return (
    <div
      data-drop-window-id={OPEN_NOW_NEW_WINDOW}
      data-new-window-target={OPEN_NOW_LAST_TARGET}
      aria-hidden="true"
      css={[
        dropBoxStyle(COLORS),
        css`
          position: relative;
          margin: 4px 8px 8px;
          &:not([data-landing]) {
            border-color: transparent;
            & > [data-drop-label-unlit-hidden] {
              display: none;
            }
          }
          /* Lit, the box is the landing: no slot drawn in it (as WindowEntryContainer's). */
          &[data-landing] [data-drag-landing-slot] {
            visibility: hidden;
          }
          /* KAN-856. Out of the pane nothing here takes the carry (D3): no ghost left in the box. */
          & [data-phantom-resting-slot] {
            visibility: hidden;
          }
        `,
        phantom === null &&
          css`
            &[data-landing] {
              position: sticky;
              bottom: 0;
              z-index: 1;
              box-shadow: 0 -8px 16px -8px rgba(0, 0, 0, 0.25);
            }
          `,
      ]}
    >
      <DropBoxLabel text={t('CarryNewWindowTarget')} hiddenUnlessLit />
      {phantom === null ? (
        <div
          css={css`
            height: ${CONTROL.ROW};
          `}
        />
      ) : (
        <DraggableRow
          rowId={phantom.rowId}
          scope={phantom.kind === 'tab' ? OPEN_TABS_SCOPE : OPEN_ITEMS_SCOPE}
        >
          <div
            css={css`
              height: ${CONTROL.ROW};
            `}
          />
          <PhantomRestingSlot />
        </DraggableRow>
      )}
    </div>
  );
}
