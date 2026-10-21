import React from 'react';

import { css } from '@emotion/react';

import Icon from './Icon';
import type { IconName } from './iconNames';
import { useFontFamily } from '../../hooks/useFontFamily';
import { mixHex } from '../../styles/mixHex';
import { useThemeColors } from '../../hooks/useThemeColors';
import { CONTROL, DURATION, RADIUS, TYPE } from '../../styles/scale';
import { tooltipDescription } from './tooltipRules';
import { focusRingCss, focusRingInInkCss } from './focusRing';

interface ButtonProps {
  text?: string;
  // The click itself, so a handler can read its count (KAN-280 O7c).
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
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
   * KAN-719. Presses do nothing and it says aria-disabled, but the label keeps
   * its ink: the face says why ("Checking…"), so it has to stay legible.
   * KAN-725. The cursor is `progress` and a press never deepens the fill.
   * Independent of `ariaDisabled`, which dims the label.
   */
  busy?: boolean;
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
  /**
   * A key that does the same as pressing the button, shown after its label
   * (KAN-311): "Reopen ⌘Z". Announced through aria-keyshortcuts, in the
   * WAI-ARIA form ("Meta+Z"), so the shown text is hidden from the accessible
   * name, which stays the label alone.
   */
  keyHint?: { text: string; ariaKeyShortcuts: string };
}

/**
 * `quiet`   the default. A bordered button on the page's own ground.
 * `primary` the one action a view is steering toward. At most one per view.
 *           Filled as the dialogs' main action is (KAN-501, KAN-511).
 * `danger`  destructive. Red ink at rest; fills red under the pointer (KAN-725).
 * `chip`    a borderless tinted fill, for a control sitting on a card rather
 *           than on the page's ground (KAN-214).
 * `outline` transparent at rest with a hairline edge, for a control laid over
 *           a row (KAN-394).
 */
export type ButtonVariant = 'quiet' | 'primary' | 'danger' | 'chip' | 'outline';

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
  busy,
  secondFace,
  keyHint,
}) => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();

  // Each kind is a resting fill and the two rungs above it, plus its edge and
  // its ink (and the ink and edge it takes under the pointer), so a variant
  // can never be half-defined.
  const bordered = `1px solid ${COLORS.CONTROL_BORDER_COLOR}`;
  const PALETTE = {
    quiet: {
      rest: COLORS.PRIMARY_COLOR,
      hover: COLORS.ICON_HOVER_COLOR,
      press: COLORS.ICON_ACTIVE_COLOR,
      border: bordered,
      ink: COLORS.TEXT_COLOR,
      hoverInk: COLORS.TEXT_COLOR,
      hoverEdge: null,
      pressEdge: null,
    },
    // The dialogs' filled rungs (dialogButtons.ts), so the two never drift.
    primary: {
      rest: COLORS.TEXT_COLOR,
      hover: mixHex(COLORS.TEXT_COLOR, COLORS.PRIMARY_COLOR, 0.88),
      press: mixHex(COLORS.TEXT_COLOR, COLORS.PRIMARY_COLOR, 0.76),
      border: `1px solid ${COLORS.TEXT_COLOR}`,
      ink: COLORS.PRIMARY_COLOR,
      hoverInk: COLORS.PRIMARY_COLOR,
      hoverEdge: null,
      pressEdge: null,
    },
    // KAN-725. Red ink on the quiet fill; the fill and its edge go red when touched.
    danger: {
      rest: COLORS.PRIMARY_COLOR,
      hover: COLORS.DANGER_FILL,
      press: COLORS.DANGER_FILL_DEEP,
      border: bordered,
      ink: COLORS.DANGER_INK,
      hoverInk: COLORS.ON_DANGER_FILL,
      hoverEdge: COLORS.DANGER_FILL,
      pressEdge: COLORS.DANGER_FILL_DEEP,
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
      ink: COLORS.TEXT_COLOR,
      hoverInk: COLORS.TEXT_COLOR,
      hoverEdge: null,
      pressEdge: null,
    },
    // KAN-674. The panel edge: over a hovered row DIVIDER fell to 1.13:1.
    outline: {
      rest: 'transparent',
      hover: COLORS.ICON_HOVER_COLOR,
      press: COLORS.ICON_ACTIVE_COLOR,
      border: `1px solid ${COLORS.PANEL_BORDER_COLOR}`,
      ink: COLORS.TEXT_COLOR,
      hoverInk: COLORS.TEXT_COLOR,
      hoverEdge: null,
      pressEdge: null,
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
      color: ${COLORS.LABEL_L2_COLOR};
    }`
    : '';

  // KAN-725. Only danger changes its edge and ink under the pointer.
  const variantRetints = PALETTE.hoverInk !== PALETTE.ink;
  // KAN-725. An unavailable danger button keeps its rest edge, label, glyph and hint when touched.
  const restsWhenTouched = Boolean(ariaDisabled) && variantRetints;
  const touchedInk = restsWhenTouched ? PALETTE.ink : PALETTE.hoverInk;
  const hoverEdge = restsWhenTouched ? null : PALETTE.hoverEdge;
  // KAN-725. A busy button ignores presses, so its press rung is its hover
  // rung: pressing again shows no deeper fill.
  const press = busy ? PALETTE.hover : PALETTE.press;
  const pressEdge = restsWhenTouched
    ? null
    : busy
      ? PALETTE.hoverEdge
      : PALETTE.pressEdge;
  // The glyph's colour is a class of its own on the Icon, so it is reached
  // from here; a caller's iconColor is its own call and is left alone.
  const glyphInk = (ink: string) =>
    iconColor || ink === PALETTE.ink
      ? ''
      : `.material-symbols-outlined { color: ${ink}; }`;

  // KAN-725. Only a variant whose edge or ink changes under the pointer
  // animates them; the others keep the one transition they had.
  const transition = variantRetints
    ? `background-color ${DURATION.COLOR}, border-color ${DURATION.COLOR}, color ${DURATION.COLOR}`
    : `background-color ${DURATION.COLOR}`;
  const hoverInkCss = touchedInk !== PALETTE.ink ? `color: ${touchedInk};` : '';

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
    cursor: ${busy ? 'progress' : 'pointer'};
    transition: ${transition};
    color: ${PALETTE.ink};
    /* KAN-311. A key hint steps up to the ink on the same trigger as the
       fill, so it never sits on the darker fill in its resting colour. */
    &:hover {
      background-color: ${PALETTE.hover};
      ${hoverEdge && `border-color: ${hoverEdge};`}
      ${hoverInkCss}
      ${glyphInk(touchedInk)}
      [data-key-hint] {
        color: ${touchedInk};
      }
    }
    /* KAN-205. One rung past the hover, so a click confirms itself. */
    &:active {
      background-color: ${press};
      ${pressEdge && `border-color: ${pressEdge};`}
      ${hoverInkCss}
      ${glyphInk(touchedInk)}
      [data-key-hint] {
        color: ${touchedInk};
      }
    }
    ${variant === 'danger' ? focusRingInInkCss() : focusRingCss(COLORS)}
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
  // bare asymmetry. Beside something, its left padding goes too (KAN-502): the
  // label has none on its right, so the content would sit 4px right of centre.
  //
  // iconStyle goes last so a caller's own padding wins. The single caller that
  // passes it (HeroContainerRight's "Add window") sends the shorthand
  // `padding: 4px 4px 2px 4px`, which is meant to override this outright.
  // Reversing the order would silently restyle that button.
  const iconSpacing = [
    imageSrc || text ? 'padding-left: 0; padding-right: 8px;' : '',
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
          color={iconColor ?? PALETTE.ink}
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

  // At rest LABEL_L1: the quietest label token that clears 4.5:1 against
  // CHIP_COLOR in every theme (KAN-311, following KAN-199's rule); L2 falls
  // to 3.12:1 in Graphite. On the hover and press fills L1 falls to 4.07:1 and
  // 3.47:1 (Ink), so there the hint takes TEXT (buttonStyle above), which
  // clears 4.86:1 on the press fill at worst (Petal). It changes colour with the
  // fill's own transition. Measured on the chip's three fills, its one
  // caller's: on another variant it has to be measured again.
  // KAN-725. On danger it rests in the label's DANGER_INK, as a danger menu item's hint does.
  const keyHintStyle = css`
    padding-left: 6px;
    color: ${variantRetints ? PALETTE.ink : COLORS.LABEL_L1_COLOR};
    transition: color ${DURATION.COLOR};
  `;

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
      data-tooltip={tooltipText}
      aria-label={ariaLabel}
      aria-description={tooltipDescription(tooltipText, ariaLabel ?? text)}
      aria-pressed={ariaPressed}
      aria-disabled={ariaDisabled || busy || undefined}
      aria-keyshortcuts={keyHint?.ariaKeyShortcuts}
      data-second-face-shown={secondFace ? String(secondFace.shown) : undefined}
      css={buttonStyle}
      onClick={ariaDisabled || busy ? undefined : onClick}
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
      {keyHint && (
        <span data-key-hint aria-hidden="true" css={keyHintStyle}>
          {keyHint.text}
        </span>
      )}
    </button>
  );
};

export default Button;
