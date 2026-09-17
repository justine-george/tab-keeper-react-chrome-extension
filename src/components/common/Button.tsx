import React from 'react';

import { css } from '@emotion/react';

import Icon from './Icon';
import type { IconName } from './iconNames';
import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import { CONTROL, DURATION, RADIUS, TYPE } from '../../styles/scale';

interface ButtonProps {
  text?: string;
  onClick?: () => void;
  imageSrc?: string;
  iconType?: IconName;
  ariaLabel?: string;
  // KAN-88. Marks a button that toggles something, and says which way it is
  // currently set. Left undefined on ordinary buttons, where React omits the
  // attribute entirely -- an aria-pressed="false" on a button that does not
  // toggle would announce it as an unpressed toggle, which is worse than
  // silence.
  ariaPressed?: boolean;
  tooltipText?: string;
  iconSize?: string;
  /** The icon's colour, for buttons whose fill would swallow the default. */
  iconColor?: string;
  iconStyle?: string;
  style?: string;
  /**
   * What kind of action this is (KAN-205).
   *
   * Exists because 15 of the 22 components carrying an onClick were building
   * their own clickable surface rather than importing this one, and the reason
   * they gave when asked (by reading them) was always the same: Button only
   * knew how to look one way. Three named kinds cover every one of them.
   *
   * `quiet` is the default because the previous, only, look was quiet -- so
   * every existing caller keeps exactly the button it had.
   */
  variant?: ButtonVariant;
  /**
   * KAN-221. The button is shown and announced as unavailable, and a click
   * does nothing -- but it stays in the tab order, which `disabled` would take
   * it out of. For an action with nothing to act on yet, like Reset with no
   * edits.
   */
  ariaDisabled?: boolean;
  /**
   * A second face the button crossfades to while `shown` (KAN-221, KAN-222):
   * "Copied" for a moment after a copy, or an eye struck through while a row
   * is hidden. The two faces share one cell as wide as the wider, so the button
   * keeps its width, and each face is centred as a unit so its icon stays
   * beside its word. The accessible name does not change; say what happened
   * from a status region, or with `ariaPressed` for a toggle.
   */
  secondFace?: {
    iconType: IconName;
    text?: string;
    shown: boolean;
    /** The crossfade's length. 200ms; shorter for a control used in runs. */
    durationMs?: number;
  };
}

/**
 * `quiet`   the default. A bordered button on the page's own ground.
 * `primary` the one action a view is steering toward. At most one per view.
 * `danger`  destructive. Its fill is the same red the delete affordances use.
 * `chip`    a borderless tinted fill, for a control sitting on a card rather
 *           than on the page's ground (KAN-214).
 */
export type ButtonVariant = 'quiet' | 'primary' | 'danger' | 'chip';

const Button: React.FC<ButtonProps> = ({
  text,
  onClick,
  imageSrc,
  iconType,
  ariaLabel,
  ariaPressed,
  tooltipText,
  iconSize,
  iconColor,
  iconStyle,
  style,
  variant = 'quiet',
  ariaDisabled,
  secondFace,
}) => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();

  // Each kind is a resting fill and the two rungs above it, plus its edge, so a
  // variant can never be half-defined: adding one means answering all four.
  const bordered = `1px solid ${COLORS.BORDER_COLOR}`;
  const PALETTE = {
    quiet: {
      rest: COLORS.PRIMARY_COLOR,
      hover: COLORS.ICON_HOVER_COLOR,
      press: COLORS.ICON_ACTIVE_COLOR,
      border: bordered,
    },
    primary: {
      rest: COLORS.SELECTION_COLOR,
      hover: COLORS.ICON_HOVER_COLOR,
      press: COLORS.ICON_ACTIVE_COLOR,
      border: bordered,
    },
    // Holds its red while pressed, as every other destructive control does:
    // measured, there is no deeper red at this hue that keeps the label on it
    // above 4.5:1 (KAN-204).
    danger: {
      rest: COLORS.DELETE_ICON_HOVER_COLOR,
      hover: COLORS.DELETE_ICON_HOVER_COLOR,
      press: COLORS.DELETE_ICON_HOVER_COLOR,
      border: bordered,
    },
    // The fill is the whole affordance, so there is no border. CHIP_COLOR sits
    // 1.20:1 from the card, which leaves the icon tokens a visible step each
    // for hover and press (chipContrast.test.ts has the numbers, and why 1.35
    // did not).
    chip: {
      rest: COLORS.CHIP_COLOR,
      hover: COLORS.ICON_HOVER_COLOR,
      press: COLORS.ICON_ACTIVE_COLOR,
      border: 'none',
    },
  }[variant];

  // Quiet on purpose: an unavailable button keeps its resting fill under the
  // pointer and when pressed, and its label drops back a rung.
  const unavailableStyle = ariaDisabled
    ? `
    color: ${COLORS.LABEL_L2_COLOR};
    cursor: default;
    &&:hover,
    &&:active {
      background-color: ${PALETTE.rest};
    }`
    : '';

  const buttonStyle = css`
    background-color: ${PALETTE.rest};
    border: ${PALETTE.border};
    padding: 10px 20px;
    height: ${CONTROL.DEFAULT};
    border-radius: ${RADIUS.SQUARE};
    display: flex;
    align-items: center;
    justify-content: space-around;
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.BODY};
    cursor: pointer;
    transition: background-color ${DURATION.COLOR};
    color: ${COLORS.TEXT_COLOR};
    &:hover {
      background-color: ${PALETTE.hover};
    }
    /* KAN-205. One rung past the hover, so a click confirms itself. */
    &:active {
      background-color: ${PALETTE.press};
    }
    ${style && style}
    ${unavailableStyle}
  `;

  const crossfade = `${secondFace?.durationMs ?? 200}ms ease`;
  const faceStyle = (visible: boolean) => css`
    grid-area: 1 / 1;
    justify-self: center;
    display: inline-flex;
    align-items: center;
    opacity: ${visible ? 1 : 0};
    filter: blur(${visible ? 0 : 2}px);
    transition:
      opacity ${crossfade},
      filter ${crossfade};
    @media (prefers-reduced-motion: reduce) {
      filter: none;
      transition: none;
    }
  `;

  // Space the icon away from whatever sits next to it, but only when there is
  // something next to it -- on an icon-only button the padding would just be a
  // bare asymmetry.
  //
  // iconStyle goes last so a caller's own padding wins. The single caller that
  // passes it (HeroContainerRight's "Add window") sends the shorthand
  // `padding: 4px 4px 2px 4px`, which is meant to override this outright.
  // Reversing the order would silently restyle that button.
  const iconSpacing = [
    imageSrc || text ? 'padding-right: 8px;' : '',
    iconStyle ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  // The icon, image and word, in that order. A function so the second face
  // is built exactly like the resting one and the two cannot drift apart.
  const face = (
    faceIcon: IconName | undefined,
    faceText: string | undefined
  ) => (
    <>
      {faceIcon && (
        <Icon
          type={faceIcon}
          disable={true}
          size={iconSize}
          color={iconColor}
          style={iconSpacing}
        />
      )}
      {imageSrc && (
        <img
          src={imageSrc}
          alt="icon"
          css={css`
            width: 30px;
            height: 30px;
            object-fit: contain;
          `}
        />
      )}
      {faceText && (
        <span
          css={css`
            ${imageSrc && 'padding-left: 8px;'}
          `}
        >
          {faceText}
        </span>
      )}
    </>
  );

  // No wrapper element: the button must be the flex child itself, otherwise a
  // width: 100% passed through `style` resolves against a shrink-wrapped div
  // and collapses back to the button's own text width.
  //
  // Deliberately no tabIndex. A <button> is keyboard-focusable by default, so
  // the only thing this element could ever compute here is a way to LOSE that
  // -- which is precisely what it used to do. `focusableButton` had no default
  // value, so `tabIndex={onClick && focusableButton ? 0 : -1}` put 32 of the
  // 36 clickable call sites out of the tab order, taking the whole settings
  // pane with them (KAN-67). The prop is gone rather than defaulted to true:
  // a prop whose only power is to break something breaks it the moment a call
  // site forgets, and 32 of 36 forgot.

  return (
    <button
      title={tooltipText}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      aria-disabled={ariaDisabled || undefined}
      data-second-face-shown={secondFace ? String(secondFace.shown) : undefined}
      css={buttonStyle}
      onClick={ariaDisabled ? undefined : onClick}
    >
      {secondFace ? (
        <span
          css={css`
            display: inline-grid;
          `}
        >
          <span
            css={faceStyle(!secondFace.shown)}
            aria-hidden={secondFace.shown || undefined}
          >
            {face(iconType, text)}
          </span>
          <span
            data-second-face
            css={faceStyle(secondFace.shown)}
            aria-hidden={!secondFace.shown || undefined}
          >
            {face(secondFace.iconType, secondFace.text)}
          </span>
        </span>
      ) : (
        face(iconType, text)
      )}
    </button>
  );
};

export default Button;
