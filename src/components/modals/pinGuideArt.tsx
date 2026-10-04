import type { ReactNode } from 'react';
import { css } from '@emotion/react';

import Icon from '../common/Icon';
import TabKeeperMark from '../common/TabKeeperMark';
import { PuzzleGlyph } from '../common/glyphs';
import { toolbarAppName } from '../../utils/functions/toolbarPin';
import { useThemeColors } from '../../hooks/useThemeColors';
import { ICON, RADIUS, TYPE } from '../../styles/scale';

// KAN-7 §4. Chrome's toolbar in three pictures, after the round-5 mock. The
// captions carry the words; these are aria-hidden by their caller.

function Badge({ label }: { label: string }) {
  const COLORS = useThemeColors();
  return (
    <span
      css={css`
        position: absolute;
        z-index: 1;
        left: -10px;
        top: -10px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        background-color: ${COLORS.TEXT_COLOR};
        color: ${COLORS.PRIMARY_COLOR};
        font-size: ${TYPE.META};
      `}
    >
      {label}
    </span>
  );
}

function Ringed({
  badge,
  solid = false,
  children,
}: {
  badge: string;
  solid?: boolean;
  children: ReactNode;
}) {
  const COLORS = useThemeColors();
  return (
    <span
      css={css`
        position: relative;
        display: inline-flex;
        padding: 3px;
        border: 2px ${solid ? 'solid' : 'dashed'} ${COLORS.TEXT_COLOR};
        color: ${COLORS.TEXT_COLOR};
      `}
    >
      <Badge label={badge} />
      {children}
    </span>
  );
}

function ToolbarStrip({ children }: { children: ReactNode }) {
  const COLORS = useThemeColors();
  return (
    <div
      css={css`
        display: flex;
        align-items: center;
        gap: 10px;
        height: 40px;
        padding: 0 10px;
        border-bottom: 1px solid ${COLORS.BORDER_COLOR};
        background-color: ${COLORS.SELECTION_COLOR};
        color: ${COLORS.TEXT_COLOR};
      `}
    >
      <span
        css={css`
          flex: 1;
          height: 22px;
          background-color: ${COLORS.PRIMARY_COLOR};
          border: 1px solid ${COLORS.DIVIDER_COLOR};
        `}
      />
      {children}
      <Icon type="more_vert" size={ICON.SMALL} />
    </div>
  );
}

export function PuzzleStepArt() {
  return (
    <ToolbarStrip>
      <Ringed badge="1">
        <PuzzleGlyph size={ICON.SMALL} />
      </Ringed>
    </ToolbarStrip>
  );
}

export function PinStepArt() {
  const COLORS = useThemeColors();
  const row = css`
    display: flex;
    align-items: center;
    gap: 8px;
  `;
  return (
    <div
      css={css`
        padding: 10px 10px 0;
      `}
    >
      <div
        css={css`
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 8px 6px 8px 10px;
          border: 1px solid ${COLORS.BORDER_COLOR};
          background-color: ${COLORS.PRIMARY_COLOR};
          color: ${COLORS.TEXT_COLOR};
        `}
      >
        <div
          css={css`
            ${row}
            opacity: 0.55;
          `}
        >
          <span
            css={css`
              width: 18px;
              height: 18px;
              border-radius: ${RADIUS.CIRCLE};
              background-color: ${COLORS.LABEL_L2_COLOR};
            `}
          />
          <span
            css={css`
              flex: 1;
              height: 8px;
              background-color: ${COLORS.LABEL_L2_COLOR};
            `}
          />
          <Icon type="keep" size={ICON.SMALL} />
        </div>
        <div css={row}>
          <TabKeeperMark />
          <span
            data-pin-app-name
            css={css`
              flex: 1;
              min-width: 0;
              overflow: hidden;
              white-space: nowrap;
              text-overflow: ellipsis;
            `}
          >
            {toolbarAppName()}
          </span>
          <Ringed badge="2">
            <Icon type="keep" size={ICON.SMALL} />
          </Ringed>
        </div>
      </div>
    </div>
  );
}

export function PinnedStepArt() {
  return (
    <ToolbarStrip>
      <Ringed badge="3" solid>
        <TabKeeperMark />
      </Ringed>
      <PuzzleGlyph size={ICON.SMALL} />
    </ToolbarStrip>
  );
}
