import React, { MouseEventHandler } from 'react';

import { css, keyframes } from '@emotion/react';

import { useThemeColors } from '../../hooks/useThemeColors';

/**
 * Logos, which Material Symbols does not carry and never will -- Google
 * removed brand marks from the set. Keyed by the same `type` string a ligature
 * uses, so a caller says `type="x"` and neither knows nor cares which path it
 * took.
 *
 * Add sparingly. Every entry is bytes in every user's bundle whether or not
 * anything renders it, the same trap the TOAST_MESSAGES comment describes.
 */
const BRAND_GLYPHS: Record<string, string> = {
  // X, from the official brand assets, drawn to a 24x24 box.
  x: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z',
};

interface IconBaseProps {
  type: string;
  faviconUrl?: string;
  /**
   * Whether the control is currently unavailable. Drives everything that
   * follows from that -- the aria-disabled state, the pointer cursor and the
   * hover highlight -- so there is exactly one prop to get right.
   *
   * It deliberately does NOT remove the icon from the tab order. See the
   * comment on aria-disabled below.
   */
  disable?: boolean;
  animationFrom?: string;
  animationTo?: string;
  animationDuration?: string;
  backgroundColor?: string;
  tooltipText?: string;
  text?: string;
  size?: string;
  style?: string;
  /**
   * Only meaningful on an actionable Icon, i.e. one with an onClick. A
   * presentational Icon is aria-hidden, so these would name nothing.
   * Introduced for OverflowMenu's trigger, which has to advertise the menu it
   * controls and whether that menu is currently open.
   */
  ariaHasPopup?: 'menu';
  ariaExpanded?: boolean;
}

/**
 * An Icon is either a control or a decoration, and the two are not allowed to
 * blur into each other.
 *
 * With its own onClick it renders role="button" and must be named. Without
 * one it is presentational: it is hidden from assistive tech, and it may not
 * carry an ariaLabel at all -- a bare aria-label would land on the implicit
 * `generic` role, where naming is prohibited, so assistive tech drops it while
 * a CSS attribute selector still matches. That silent gap was KAN-56, and this
 * union is what makes it a compile error rather than a thing to remember.
 *
 * When the click handler belongs on a wrapper rather than the icon, reach for
 * ClickableRow instead of labelling the icon and hoping the label surfaces.
 */
type IconProps = IconBaseProps &
  (
    | { onClick: MouseEventHandler; ariaLabel: string }
    | { onClick?: never; ariaLabel?: never }
  );

const Icon: React.FC<IconProps> = ({
  type,
  faviconUrl,
  onClick,
  disable,
  animationFrom,
  animationTo,
  animationDuration,
  // Transparent by default, so an Icon paints nothing of its own unless a
  // caller asks for it (KAN-98). It used to be undefined, which emotion
  // emitted as `background-color: undefined` for the browser to discard --
  // the same result by accident rather than by statement.
  backgroundColor = 'transparent',
  ariaLabel,
  tooltipText,
  text,
  size = '1.5rem',
  style,
  ariaHasPopup,
  ariaExpanded,
}) => {
  const COLORS = useThemeColors();

  // role="button" promises Enter AND Space. This has to be hand-rolled rather
  // than handed to a native <button>, because Button.tsx renders a <button>
  // that contains an Icon, and nested buttons are invalid HTML -- the browser
  // recovers by unnesting the DOM.
  //
  // Forwarding to the element's own click() rather than calling onClick(e)
  // directly is what lets onClick stay a MouseEventHandler honestly: React
  // dispatches a real MouseEvent to the existing handler. Calling it with the
  // keyboard event needed an `as any`, which compiled while handing every
  // caller an object missing every mouse-specific field.
  function handleKeyPress(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    // Space scrolls the page by default; Enter is harmless but is prevented
    // too so the two keys cannot drift apart again.
    e.preventDefault();
    e.currentTarget.click();
  }

  // Define keyframe animation
  const hoverAnimation =
    animationFrom &&
    animationTo &&
    css`
      &:hover {
        animation: ${keyframes`
      from {
        ${animationFrom}
      }
      to {
        ${animationTo}
      }
    `} ${animationDuration ? animationDuration : `0.25s`} linear 1;
      }
    `;

  const hoverColor =
    type === 'delete'
      ? COLORS.DELETE_ICON_HOVER_COLOR
      : COLORS.ICON_HOVER_COLOR;

  const iconStyle = css`
    font-size: ${size};
    width: ${size};
    height: ${size};
    object-fit: contain;
    color: ${COLORS.TEXT_COLOR};
    ${hoverAnimation}
  `;

  // An icon affords a click when it has one to give and is not disabled. This
  // used to key off a separate `focusable` prop, which also drove the tab
  // index -- so call sites reached for it to control the look and silently
  // edited the tab order (KAN-68).
  const isActionable = Boolean(onClick) && !disable;

  // The non-actionable branch below is `inherit`, not `default`, and the
  // distinction is KAN-76. `isActionable` answers "does this icon handle its
  // own click?" -- a fact about this element. The cursor asks "is the thing
  // under the pointer clickable?" -- a fact about the whole subtree, which an
  // icon cannot see. An icon without its own onClick is usually sitting inside
  // something that does have one: Button passes `disable` to its inner Icon at
  // every one of its call sites, and a bare Icon inside a ClickableRow has no
  // onClick by design. Both render a real <button> carrying `cursor: pointer`,
  // and `default` here painted over it from the inside.
  //
  // `inherit` is the icon declining to answer a question it cannot answer.
  // Inside a button it resolves to pointer; for a disabled Undo/Redo sitting
  // in a plain layout div it resolves to the div's `auto`, which paints the
  // same arrow `default` did -- the container sets `user-select: none`, so
  // `auto` never becomes an I-beam here.
  //
  // Since `cursor` is an inherited property, this is equivalent to dropping
  // the declaration entirely. It is spelled out so the next person to read
  // this line sees a decision rather than an omission to fill in.
  const containerStyle = css`
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding: 4px;
    cursor: ${isActionable ? 'pointer' : 'inherit'};
    user-select: none;
    transition: background-color 0.2s;
    background-color: ${backgroundColor};
    ${isActionable &&
    `&:hover {
      background-color: ${hoverColor};
    }`}
    ${style && style}
  `;

  return (
    // tab-focus only if the icon is clickable
    // set role as button for accessibility
    <div
      title={tooltipText}
      aria-label={ariaLabel}
      // Presentational icons are hidden outright rather than merely unnamed.
      // The glyph renders as ligature text ("arrow_back", "add_box"), which
      // would otherwise leak into the accessible name of whatever button
      // contains it -- Button's inner Icon is exactly that case.
      aria-hidden={onClick ? undefined : true}
      // Announced as unavailable, but still reachable -- deliberately, and
      // against KAN-66's stated direction. The sync icon disables WHILE you
      // are operating it: press Enter, the thunk starts, `disable` flips true.
      // A control that leaves the tab order at that instant drops focus to
      // <body> and loses the user's place. aria-disabled states the fact
      // without the focus loss, which is what it exists for.
      aria-disabled={disable ? true : undefined}
      // Hover state must never reach this: it is a pointer-only signal, and
      // routing it here is what made eight row controls keyboard-unreachable
      // (KAN-68).
      tabIndex={onClick ? 0 : -1}
      css={containerStyle}
      onClick={!disable ? onClick : undefined}
      onKeyDown={(e) => handleKeyPress(e)}
      role={onClick ? 'button' : undefined}
      // Guarded on onClick for the same reason as aria-label above: a
      // presentational Icon is aria-hidden, so these would describe nothing.
      aria-haspopup={onClick ? ariaHasPopup : undefined}
      aria-expanded={
        onClick && ariaExpanded !== undefined ? ariaExpanded : undefined
      }
    >
      {faviconUrl ? (
        <img src={faviconUrl} alt="favicon" css={iconStyle} />
      ) : (
        <div
          css={css`
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
          `}
        >
          {BRAND_GLYPHS[type] ? (
            // A brand mark, not a ligature. Material Symbols carries no logos
            // at all, so `type="x"` would render the LETTER x -- an unavailable
            // ligature falls back to literal text rather than to tofu, which is
            // exactly the failure KAN-5 had to measure inked width to catch.
            // Drawn at the same box and colour as a ligature so callers cannot
            // tell the two apart.
            <svg
              css={iconStyle}
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
              focusable="false"
            >
              <path d={BRAND_GLYPHS[type]} />
            </svg>
          ) : (
            <span css={iconStyle} className="material-symbols-outlined">
              {type}
            </span>
          )}
          {text && (
            <p
              css={css`
                margin: 0;
                color: ${COLORS.TEXT_COLOR};
              `}
            >
              {text}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default Icon;
