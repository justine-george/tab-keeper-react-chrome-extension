import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { css } from '@emotion/react';

import Icon from './Icon';
import type { IconName } from './iconNames';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useFontFamily } from '../../hooks/useFontFamily';
import { ICON, TYPE } from '../../styles/scale';
import { slidingPairColors } from './slidingPairColors';

/** One side of a SlidingPair. */
export interface SlidingOption<T extends string> {
  value: T;
  /** The accessible name, and the visible word when there is no glyph. */
  label: string;
  /** Shown in place of the word. The label then becomes the tooltip too. */
  icon?: IconName;
  /** How far the knob's copy of the glyph turns while this side is pressed. */
  pressedTurn?: string;
}

/**
 * The numbers a pair is drawn with, supplied by the call site (KAN-248).
 *
 * The export page and the popup are on different scales: the export toolbar
 * draws its pairs at 34px with 3px corners and a 280ms overshoot (KAN-218),
 * the popup at CONTROL.ROW, RADIUS.SQUARE and DURATION.MOVE. The component
 * carries neither set, so it can live in common/ and pass the scale scan
 * while each page keeps its own look; the export's numbers live where the
 * scan exempts them (export/slidingPairStyle.ts).
 */
export interface SlidingPairMetrics {
  /** The track's outer height. */
  height: string;
  /** The track's corner. */
  radius: string;
  /** The knob's corner, and each cell's. */
  knobRadius: string;
  /** The knob's slide -- duration and easing, applied to clip-path and to a glyph's turn. */
  slide: string;
  /** The track's dip while pressed -- duration and easing, applied to transform. */
  press: string;
}

/** The inset between the track's frame and the knob. */
const TRACK_PADDING = 2;

/**
 * A two-way choice drawn as a track with a knob under the pressed side
 * (KAN-218). Replaces the export toolbar's segmented pairs.
 *
 * Two real buttons carry the state (`aria-pressed`), the names and the clicks.
 * Over them lies an `aria-hidden` copy of both labels in the pressed style,
 * clipped to the pressed button's box. Moving the clip is the slide, and
 * because every pixel of a label belongs to exactly one layer, a word crossing
 * the knob's edge is dark on the track and light on the knob in the same frame
 * -- which fading the label's colour cannot do.
 *
 * A toggle to a POINTER: clicking the pressed side selects the other one, so a
 * click anywhere on the pair, the knob included, flips it.
 *
 * Not to the keyboard (KAN-225). To a screen reader the pair is two toggle
 * buttons -- "Compact, toggle button, pressed" -- and activating a pressed
 * button is announced as nothing, so having it select the OTHER one is an
 * action on one control silently changing another. Keyboard activation of
 * the pressed side therefore does nothing, the ordinary segmented-control
 * contract, and activation of the other side still selects it.
 */
export default function SlidingPair<T extends string>({
  label,
  options,
  value,
  onChange,
  metrics,
}: {
  label: string;
  options: readonly [SlidingOption<T>, SlidingOption<T>];
  value: T;
  onChange: (value: T) => void;
  metrics: SlidingPairMetrics;
}) {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const colors = slidingPairColors(COLORS);

  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const knob = useRef<HTMLSpanElement>(null);
  const [clip, setClip] = useState<string>();
  // Off until the first measured position has painted, so the knob does not
  // slide in from the left edge when the page opens.
  const [moving, setMoving] = useState(false);

  // Measured from the rendered buttons, never assumed: the words differ in
  // width, and in every language. Re-measured when a button resizes, which is
  // what a late font or a language change does.
  useLayoutEffect(() => {
    const measure = () => {
      const index = options.findIndex((option) => option.value === value);
      const button = buttons.current[index];
      const layer = knob.current;
      if (!button || !layer) return;
      // Fractional rects, not offsetLeft/offsetWidth: those round to whole
      // pixels, and measured in Japanese and Chinese the knob stopped 0.61px
      // short of the pressed word. A rect is transformed, though, and the track
      // dips to 97% while pressed -- which is exactly when this runs -- so each
      // distance is divided back by the layer's current scale.
      const knobBox = layer.getBoundingClientRect();
      const buttonBox = button.getBoundingClientRect();
      const scale = knobBox.width / parseFloat(getComputedStyle(layer).width);
      if (!scale) return;
      const left = (buttonBox.left - knobBox.left) / scale;
      const right = (knobBox.right - buttonBox.right) / scale;
      setClip(
        `inset(0px ${right}px 0px ${left}px round ${metrics.knobRadius})`
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    buttons.current.forEach((button) => button && observer.observe(button));
    return () => observer.disconnect();
  }, [options, value, metrics.knobRadius]);

  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setMoving(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);

  const trackStyle = css`
    position: relative;
    box-sizing: border-box;
    height: ${metrics.height};
    display: inline-flex;
    align-items: stretch;
    padding: ${TRACK_PADDING}px;
    border: 1px solid ${COLORS.BORDER_COLOR};
    border-radius: ${metrics.radius};
    background-color: ${colors.track};
    transition: transform ${metrics.press};
    &:active {
      transform: scale(0.97);
    }
    @media (prefers-reduced-motion: reduce) {
      transition: none;
      &:active {
        transform: none;
      }
    }
  `;

  // Shared by the buttons and the knob's copies, so the two lie exactly over
  // each other.
  const cellStyle = (option: SlidingOption<T>) => css`
    box-sizing: border-box;
    display: grid;
    place-items: center;
    margin: 0;
    padding: ${option.icon ? '0 2px' : '0 12px'};
    border: 0;
    border-radius: ${metrics.knobRadius};
    background: transparent;
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.BODY};
    line-height: normal;
    white-space: nowrap;
  `;

  const buttonStyle = (option: SlidingOption<T>) => css`
    ${cellStyle(option)}
    color: ${option.icon ? colors.glyph : colors.word};
    cursor: pointer;
    @media (hover: hover) and (pointer: fine) {
      &:not([aria-pressed='true']):hover {
        background-color: ${COLORS.ICON_HOVER_COLOR};
      }
    }
  `;

  const knobStyle = css`
    position: absolute;
    inset: ${TRACK_PADDING}px;
    display: flex;
    align-items: stretch;
    border-radius: ${metrics.knobRadius};
    background-color: ${colors.knob};
    color: ${colors.labelOnKnob};
    pointer-events: none;
    ${moving ? `transition: clip-path ${metrics.slide};` : ''}
    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `;

  const content = (option: SlidingOption<T>, onKnob: boolean) =>
    option.icon ? (
      <Icon
        type={option.icon}
        size={ICON.SMALL}
        color={onKnob ? colors.labelOnKnob : colors.glyph}
        style={
          onKnob
            ? `font-variation-settings: 'FILL' 1;
               rotate: ${
                 option.value === value ? option.pressedTurn ?? '0deg' : '0deg'
               };
               ${moving ? `transition: rotate ${metrics.slide};` : ''}
               @media (prefers-reduced-motion: reduce) { transition: none; }`
            : ''
        }
      />
    ) : (
      option.label
    );

  return (
    <span css={trackStyle} role="group" aria-label={label}>
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(el) => {
            buttons.current[index] = el;
          }}
          type="button"
          aria-label={option.label}
          aria-pressed={option.value === value}
          title={option.icon ? option.label : undefined}
          css={buttonStyle(option)}
          onClick={(e) => {
            if (option.value !== value) {
              onChange(option.value);
              return;
            }
            // The pressed side. A pointer flips the pair; a keyboard or
            // assistive activation does nothing. The browser tells them
            // apart: a click synthesised from Enter, Space or a screen
            // reader carries `detail === 0`, a pointer click its click
            // count (UI Events, "detail"). The same rule keeps a
            // programmatic .click() from flipping it, which is right --
            // nothing that is not a pointer is aiming at the knob.
            if (e.detail === 0) return;
            onChange(options[1 - index].value);
          }}
        >
          {content(option, false)}
        </button>
      ))}
      <span
        ref={knob}
        aria-hidden="true"
        data-sliding-knob={value}
        css={knobStyle}
        style={{ clipPath: clip }}
      >
        {options.map((option) => (
          <span key={option.value} css={cellStyle(option)}>
            {content(option, true)}
          </span>
        ))}
      </span>
    </span>
  );
}
