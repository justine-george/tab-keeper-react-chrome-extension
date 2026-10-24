import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { css, keyframes, type SerializedStyles } from '@emotion/react';

import { DURATION, EASE } from '../../styles/scale';
import { prefersReducedMotion } from '../modals/getStartedMotion';
import type { IconName } from './iconNames';
import {
  CLOUD_DONE_PATH,
  type MorphPair,
  MORPH_UPRIGHT,
  SYNC_PATH,
} from './syncMorph.data';
import {
  easeInOutCubic,
  INTO_TURN_EASE,
  MORPH_MS,
  morphPath,
  morphSetFor,
  SETTLE_EASE,
  settlePose,
  TURN_MS,
  UNSEEN_MS,
} from './syncMotion';

// KAN-750. The sync button's glyph: `sync` turns while syncing and morphs to and
// from `cloud_done`; any other change crossfades; reduced motion swaps at once.

type OutlinedGlyph = 'sync' | 'cloud_done';
const OUTLINES: Record<OutlinedGlyph, string> = {
  sync: SYNC_PATH,
  cloud_done: CLOUD_DONE_PATH,
};
const isOutlined = (glyph: IconName): glyph is OutlinedGlyph =>
  glyph === 'sync' || glyph === 'cloud_done';

const turn = keyframes`to { transform: rotate(-360deg); }`;
const fadeIn = keyframes`from { opacity: 0; }`;
const fadeOut = keyframes`to { opacity: 0; }`;

interface Morph {
  pairs: MorphPair[];
  fromDeg: number;
  toDeg: number;
  easing: string;
  // Plays the pairs from `to` back to `from`: the cloud flowing into arrows.
  intoArrows: boolean;
}

interface Layer {
  key: number;
  glyph: IconName;
  // Only a sync turns, and never under reduced motion.
  turns: boolean;
  // A morph into a turning sync hands over a quarter turn in.
  turnsFromQuarter: boolean;
  morph: Morph | null;
  fade: 'in' | 'out' | null;
}

// Where a turning outline is now, in degrees (counter-clockwise is negative); 0 if unknown.
function turnAngle(el: Element | undefined): number {
  // A CSS animation names its keyframes; the Web Animations rotation does not.
  const cssTurn = el?.getAnimations?.().find((a) => 'animationName' in a);
  const progress = cssTurn?.effect?.getComputedTiming().progress;
  return progress == null ? 0 : -progress * 360;
}

function frameAt(morph: Morph, t: number): string {
  return morphPath(morph.pairs, easeInOutCubic(morph.intoArrows ? 1 - t : t));
}

function MorphingOutline({
  layerKey,
  morph,
  glyphCss,
  onEnd,
}: {
  layerKey: number;
  morph: Morph;
  glyphCss: SerializedStyles;
  onEnd: (layerKey: number) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const path = useRef<SVGPathElement>(null);
  const [firstFrame] = useState(() => frameAt(morph, 0));

  useLayoutEffect(() => {
    const el = svg.current;
    const rotation =
      el && typeof el.animate === 'function'
        ? el.animate(
            [
              { transform: `rotate(${morph.fromDeg}deg)` },
              { transform: `rotate(${morph.toDeg}deg)` },
            ],
            { duration: MORPH_MS, easing: morph.easing, fill: 'forwards' }
          )
        : null;
    const start = performance.now();
    let frame: number | undefined;
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / MORPH_MS);
      path.current?.setAttribute('d', frameAt(morph, t));
      frame = t < 1 ? requestAnimationFrame(step) : undefined;
    };
    if (typeof requestAnimationFrame === 'function')
      frame = requestAnimationFrame(step);
    // The timer, not the frames, ends the morph: it runs where frames do not.
    const end = setTimeout(() => onEnd(layerKey), MORPH_MS);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearTimeout(end);
      rotation?.cancel();
    };
  }, [layerKey, morph, onEnd]);

  return (
    <svg
      ref={svg}
      css={[glyphCss, blockCss]}
      viewBox="0 -960 960 960"
      fill="currentColor"
      focusable="false"
    >
      <path ref={path} d={firstFrame} />
    </svg>
  );
}

const blockCss = css`
  display: block;
`;
const stackCss = css`
  display: grid;
  & > * {
    grid-area: 1 / 1;
  }
`;
const fadeCss = {
  in: css`
    animation: ${fadeIn} ${DURATION.MOVE} ${EASE.OUT} both;
  `,
  out: css`
    animation: ${fadeOut} ${DURATION.MOVE} ${EASE.OUT} both;
  `,
};
const turnCss = (fromQuarter: boolean) => css`
  animation: ${turn} ${TURN_MS}ms linear infinite;
  animation-delay: ${fromQuarter ? -TURN_MS / 4 : 0}ms;
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

interface SyncGlyphProps {
  glyph: IconName;
  turning: boolean;
  // The size and colour a ligature would get (Icon's renderGlyph hands them over).
  glyphCss: SerializedStyles;
}

const SyncGlyph: React.FC<SyncGlyphProps> = ({ glyph, turning, glyphCss }) => {
  const root = useRef<HTMLSpanElement>(null);
  const [mountedAt] = useState(() => performance.now());
  // The glyph last asked for, and since when.
  const asked = useRef({ glyph, turning, since: mountedAt });
  const nextKey = useRef(1);
  const outlines = useRef(new Map<number, SVGSVGElement>());
  const [layers, setLayers] = useState<Layer[]>(() => [
    {
      key: 0,
      glyph,
      turns: turning && glyph === 'sync' && !prefersReducedMotion(),
      turnsFromQuarter: false,
      morph: null,
      fade: null,
    },
  ]);
  const top = layers[layers.length - 1];

  const endMorph = useCallback((key: number) => {
    setLayers((ls) =>
      ls.map((l) => (l.key === key && l.morph ? { ...l, morph: null } : l))
    );
  }, []);

  useLayoutEffect(() => {
    const was = asked.current;
    if (was.glyph === glyph && was.turning === turning) return;
    const reduced = prefersReducedMotion();
    const turns = turning && glyph === 'sync' && !reduced;
    if (was.glyph === glyph) {
      asked.current = { ...was, turning };
      setLayers((ls) =>
        ls.map((l) =>
          l.fade === 'out' ? l : { ...l, turns, turnsFromQuarter: false }
        )
      );
      return;
    }
    const now = performance.now();
    asked.current = { glyph, turning, since: now };
    const fresh: Layer = {
      key: nextKey.current++,
      glyph,
      turns,
      turnsFromQuarter: false,
      morph: null,
      fade: null,
    };
    if (reduced || now - was.since < UNSEEN_MS) {
      setLayers([fresh]);
      return;
    }
    if (isOutlined(was.glyph) && isOutlined(glyph)) {
      const intoArrows = glyph === 'sync';
      // Into the cloud: from where the turn is to the next upright-looking pose.
      // Into arrows: a quarter turn where the turn picks up, or a half to rest.
      const fromDeg = intoArrows ? 0 : turnAngle(outlines.current.get(top.key));
      const toDeg = intoArrows ? (turns ? -90 : -180) : settlePose(fromDeg);
      setLayers([
        {
          ...fresh,
          turnsFromQuarter: turns,
          morph: {
            pairs: intoArrows ? MORPH_UPRIGHT : morphSetFor(toDeg),
            fromDeg,
            toDeg,
            easing: intoArrows ? INTO_TURN_EASE : SETTLE_EASE,
            intoArrows,
          },
        },
      ]);
      return;
    }
    // A running morph stops on its outline and fades from there.
    setLayers((ls) => [
      ...ls
        .filter((l) => l.fade !== 'out')
        .map((l) => ({ ...l, morph: null, fade: 'out' as const })),
      { ...fresh, fade: 'in' },
    ]);
  }, [glyph, turning, top.key]);

  // A faded-out layer goes when its own fade-out ends (or is cancelled): not a turn
  // inside it, nor the fade-in Chromium cancels when a change swaps it for the fade-out.
  // Native, not onAnimationEnd: React's does not fire for a dispatched animationend in jsdom.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onEnd = (event: Event) => {
      if (!('animationName' in event) || event.animationName !== fadeOut.name)
        return;
      const layer = event.target;
      if (!(layer instanceof HTMLElement) || layer.parentElement !== el) return;
      const key = Number(layer.dataset.layer);
      setLayers((ls) => ls.filter((l) => l.key !== key || l.fade !== 'out'));
    };
    el.addEventListener('animationend', onEnd);
    el.addEventListener('animationcancel', onEnd);
    return () => {
      el.removeEventListener('animationend', onEnd);
      el.removeEventListener('animationcancel', onEnd);
    };
  }, []);

  const drawn = (l: Layer) => {
    if (l.morph)
      return (
        <MorphingOutline
          layerKey={l.key}
          morph={l.morph}
          glyphCss={glyphCss}
          onEnd={endMorph}
        />
      );
    if (isOutlined(l.glyph))
      return (
        <svg
          ref={(el) => {
            if (el) outlines.current.set(l.key, el);
            else outlines.current.delete(l.key);
          }}
          css={[glyphCss, blockCss, l.turns && turnCss(l.turnsFromQuarter)]}
          viewBox="0 -960 960 960"
          fill="currentColor"
          focusable="false"
        >
          <path d={OUTLINES[l.glyph]} />
        </svg>
      );
    return (
      <span css={[glyphCss, blockCss]} className="material-symbols-outlined">
        {l.glyph}
      </span>
    );
  };

  return (
    <span
      ref={root}
      data-glyph={top.glyph}
      data-turning={String(top.turns)}
      aria-hidden="true"
      css={stackCss}
    >
      {layers.map((l) => (
        <span key={l.key} data-layer={l.key} css={l.fade && fadeCss[l.fade]}>
          {drawn(l)}
        </span>
      ))}
    </span>
  );
};

export default SyncGlyph;
