import React, { MouseEventHandler } from 'react';

import { css, keyframes } from '@emotion/react';

import { useThemeColors } from '../../hooks/useThemeColors';

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
  backgroundColor,
  ariaLabel,
  tooltipText,
  text,
  size = '1.5rem',
  style,
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
          <span css={iconStyle} className="material-symbols-outlined">
            {type}
          </span>
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
