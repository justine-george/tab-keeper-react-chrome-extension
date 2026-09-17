import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { css } from '@emotion/react';

import Icon from '../common/Icon';
import type { IconName } from '../common/iconNames';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useFontFamily } from '../../hooks/useFontFamily';
import { ICON, TYPE } from '../../styles/scale';
import { KNOB_TRANSITION, slidingPairColors } from './slidingPairStyle';

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

const TRACK_PADDING = 2;
const KNOB_RADIUS = '2px';

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
 * A toggle: pressing the pressed side selects the other one, so a click
 * anywhere on the pair, the knob included, flips it.
 */
export default function SlidingPair<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly [SlidingOption<T>, SlidingOption<T>];
  value: T;
  onChange: (value: T) => void;
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
      setClip(`inset(0px ${right}px 0px ${left}px round ${KNOB_RADIUS})`);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    buttons.current.forEach((button) => button && observer.observe(button));
    return () => observer.disconnect();
  }, [options, value]);

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
    height: 34px;
    display: inline-flex;
    align-items: stretch;
    padding: ${TRACK_PADDING}px;
    border: 1px solid ${COLORS.BORDER_COLOR};
    border-radius: 3px;
    background-color: ${colors.track};
    transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1);
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
    border-radius: ${KNOB_RADIUS};
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
    border-radius: ${KNOB_RADIUS};
    background-color: ${colors.knob};
    color: ${colors.labelOnKnob};
    pointer-events: none;
    ${moving ? `transition: clip-path ${KNOB_TRANSITION};` : ''}
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
               ${moving ? `transition: rotate ${KNOB_TRANSITION};` : ''}
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
          onClick={() =>
            onChange(
              option.value === value ? options[1 - index].value : option.value
            )
          }
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
