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
  type MorphPair,
  CLOUD_DONE_UPRIGHT,
  SYNC_PATH,
} from './syncMorph.data';
import {
  blendPoints,
  easeInOutCubic,
  INTO_TURN_EASE,
  isMorphTarget,
  MORPH_MS,
  MORPH_TARGETS,
  type MorphTarget,
  morphPath,
  morphSetFor,
  pairsFromFrame,
  SETTLE_EASE,
  settlePose,
  TURN_MS,
  UNSEEN_MS,
} from './syncMotion';

// KAN-750. The sync button's glyph: `sync` turns while syncing and morphs to and
// from `cloud_done` and `sync_problem`; any other change crossfades; reduced
// motion swaps at once.

type OutlinedGlyph = 'sync' | MorphTarget;
const isOutlined = (glyph: IconName): glyph is OutlinedGlyph =>
  glyph === 'sync' || isMorphTarget(glyph);
const outlineOf = (glyph: OutlinedGlyph): string =>
  glyph === 'sync' ? SYNC_PATH : MORPH_TARGETS[glyph].path;

const turn = keyframes`to { transform: rotate(-360deg); }`;
const fadeIn = keyframes`from { opacity: 0; }`;
const fadeOut = keyframes`to { opacity: 0; }`;

// The arrows unchanged: a turn that stops settles without a change of shape.
const ARROWS_STILL: MorphPair[] = CLOUD_DONE_UPRIGHT.map(({ from }) => ({
  from,
  to: from,
}));

interface Morph {
  // From the shape it starts at to the shape it ends at, in the turned frame.
  pairs: MorphPair[];
  fromDeg: number;
  toDeg: number;
  easing: string;
}

// What a running morph shows now: its last frame's points and its rotation.
interface LiveFrame {
  points: number[][];
  deg: number;
}

interface Layer {
  key: number;
  glyph: IconName;
  // Only a sync turns, and never under reduced motion.
  turns: boolean;
  // The angle the turn starts from: where a morph into it ended.
  turnStartDeg: number;
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

function MorphingOutline({
  layerKey,
  morph,
  glyphCss,
  onEnd,
  onLive,
}: {
  layerKey: number;
  morph: Morph;
  glyphCss: SerializedStyles;
  onEnd: (layerKey: number) => void;
  // Hands over how to read the frame on screen, null once the morph is gone.
  onLive: (layerKey: number, read: (() => LiveFrame) | null) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const path = useRef<SVGPathElement>(null);
  const [firstFrame] = useState(() => morphPath(morph.pairs, 0));

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
    // The eased progress of the last frame drawn.
    let drawn = 0;
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / MORPH_MS);
      drawn = easeInOutCubic(t);
      path.current?.setAttribute('d', morphPath(morph.pairs, drawn));
      frame = t < 1 ? requestAnimationFrame(step) : undefined;
    };
    onLive(layerKey, () => ({
      points: morph.pairs.map((pair) => blendPoints(pair, drawn)),
      // Unrotated where there are no Web Animations.
      deg: rotation
        ? morph.fromDeg +
          (morph.toDeg - morph.fromDeg) *
            (rotation.effect?.getComputedTiming().progress ?? 0)
        : 0,
    }));
    if (typeof requestAnimationFrame === 'function')
      frame = requestAnimationFrame(step);
    // The timer, not the frames, ends the morph: it runs where frames do not.
    const end = setTimeout(() => onEnd(layerKey), MORPH_MS);
    return () => {
      onLive(layerKey, null);
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearTimeout(end);
      rotation?.cancel();
    };
  }, [layerKey, morph, onEnd, onLive]);

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
// A negative delay starts the turn part way round, at startDeg.
const turnCss = (startDeg: number) => css`
  animation: ${turn} ${TURN_MS}ms linear infinite;
  animation-delay: ${-((((-startDeg % 360) + 360) % 360) * TURN_MS) / 360}ms;
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
      turnStartDeg: 0,
      morph: null,
      fade: null,
    },
  ]);
  const top = layers[layers.length - 1];

  const liveFrames = useRef(new Map<number, () => LiveFrame>());
  const setLiveFrame = useCallback(
    (key: number, read: (() => LiveFrame) | null) => {
      if (read) liveFrames.current.set(key, read);
      else liveFrames.current.delete(key);
    },
    []
  );
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
    // A morph cut short by this change: start from the frame it shows.
    const live = liveFrames.current.get(top.key)?.();
    const startPairs = (ends: MorphPair[]) =>
      live ? pairsFromFrame(live.points, ends) : ends;
    if (was.glyph === glyph) {
      asked.current = { ...was, turning };
      // A turn that stops settles to the next upright-looking pose, as a landing does.
      let settle: Morph | null = null;
      if (glyph === 'sync' && was.turning && !turning && !reduced) {
        const fromDeg = live?.deg ?? turnAngle(outlines.current.get(top.key));
        settle = {
          pairs: startPairs(ARROWS_STILL),
          fromDeg,
          toDeg: settlePose(fromDeg),
          easing: SETTLE_EASE,
        };
      }
      setLayers((ls) =>
        ls.map((l) =>
          l.fade === 'out'
            ? l
            : {
                ...l,
                turns,
                turnStartDeg: 0,
                morph: l.key === top.key && settle ? settle : l.morph,
              }
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
      turnStartDeg: 0,
      morph: null,
      fade: null,
    };
    if (reduced || now - was.since < UNSEEN_MS) {
      setLayers([fresh]);
      return;
    }
    // Only between the arrows and a glyph they morph into.
    const target = glyph === 'sync' ? was.glyph : glyph;
    const morphs =
      (was.glyph === 'sync' || glyph === 'sync') && isMorphTarget(target);
    if (morphs) {
      const intoArrows = glyph === 'sync';
      // From where the glyph is turned now; a glyph at rest is upright.
      const fromDeg =
        live?.deg ??
        (intoArrows ? 0 : turnAngle(outlines.current.get(top.key)));
      // Into the cloud: to the next upright-looking pose. Into turning arrows: a
      // quarter turn on, where the turn picks up. Into still arrows: no turn from
      // rest, else to the next upright-looking pose.
      let toDeg = settlePose(fromDeg);
      if (intoArrows && turns) toDeg = fromDeg - 90;
      else if (intoArrows && fromDeg % 180 === 0) toDeg = fromDeg;
      const ends = intoArrows
        ? MORPH_TARGETS[target].intoArrows
        : morphSetFor(target, toDeg);
      setLayers([
        {
          ...fresh,
          turnStartDeg: turns ? toDeg : 0,
          morph: {
            pairs: startPairs(ends),
            fromDeg,
            toDeg,
            easing: intoArrows && turns ? INTO_TURN_EASE : SETTLE_EASE,
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
          onLive={setLiveFrame}
        />
      );
    if (isOutlined(l.glyph))
      return (
        <svg
          ref={(el) => {
            if (el) outlines.current.set(l.key, el);
            else outlines.current.delete(l.key);
          }}
          css={[glyphCss, blockCss, l.turns && turnCss(l.turnStartDeg)]}
          viewBox="0 -960 960 960"
          fill="currentColor"
          focusable="false"
        >
          <path d={outlineOf(l.glyph)} />
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
