// Bakes the sync -> cloud_done and sync -> sync_problem morph outlines into src/components/common/syncMorph.data.ts (KAN-750).
//
// The popup blends the sync arrows into the cloud-with-check, or into the arrows
// with a "!" (a failed sync), with a plain linear
// blend between two matched point lists. Matching them needs flubber, which stays
// out of the bundle: this script is run BY HAND and its output is committed.
//
// Run it whenever the glyph paths or the pairing change:
//
//   npm run morph:build
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import flubber from 'flubber';
import { format, resolveConfig } from 'prettier';

const { interpolate, splitPathString } = flubber;

const OUT = fileURLToPath(
  new URL('../src/components/common/syncMorph.data.ts', import.meta.url)
);

// Material Symbols Outlined, weight 400: @material-symbols/svg-400@0.47.6,
// outlined/sync.svg, outlined/cloud_done.svg and outlined/sync_problem.svg.
// viewBox "0 -960 960 960".
const SYNC_PATH =
  'M167-160v-60h130l-15-12q-64-51-93-111t-29-134q0-106 62.5-190.5T387-784v62q-75 29-121 96.5T220-477q0 63 23.5 109.5T307-287l30 21v-124h60v230H167Zm407-15v-63q76-29 121-96.5T740-483q0-48-23.5-97.5T655-668l-29-26v124h-60v-230h230v60H665l15 14q60 56 90 120t30 123q0 106-62 191T574-175Z';
const CLOUD_DONE_PATH =
  'm412-279 230-230-40-40-189 189-100-100-41 41 140 140ZM251-160q-88 0-149.5-61.5T40-371q0-78 50-137t127-71q20-97 94-158.5T482-799q112 0 189 81.5T748-522v24q72-2 122 46.5T920-329q0 69-50 119t-119 50H251Zm0-60h500q45 0 77-32t32-77q0-45-32-77t-77-32h-63v-84q0-91-61-154t-149-63q-88 0-149.5 63T267-522h-19q-62 0-105 43.5T100-371q0 63 44 107t107 44Z';
const SYNC_PROBLEM_PATH =
  'M132-160v-60h123l-14-14q-60-60-86.5-121.5T128-476q0-109 62.5-195T355-790v62q-76 30-121.5 99T188-476q0 52 17.5 98.5T265-293l30 27v-117h60v223H132Zm327-131q-9-9-9-21t9-21q9-9 21-9t21 9q9 9 9 21t-9 21q-9 9-21 9t-21-9Zm-7-139v-249h60v249h-60Zm153 261v-63q76-29 121.5-98T772-483q0-54-18-100.5T695-667l-30-27v117h-60v-223h223v60H704l15 14q62 57 87.5 120T832-483q0 108-63 194.5T605-169Z';

const MAX_SEGMENT = 24;
// The two halves of the cloud overlap by 12 units so no seam shows between them.
const CUT_LEFT = 486;
const CUT_RIGHT = 474;

// A path's closed outlines as point rings.
export function outlineRings(d) {
  return splitPathString(d).map((sub) =>
    interpolate(sub, sub, { string: false, maxSegmentLength: MAX_SEGMENT })(0)
  );
}

const signed = (r) =>
  r.reduce((s, [x, y], i) => {
    const [nx, ny] = r[(i + 1) % r.length];
    return s + x * ny - nx * y;
  }, 0) / 2;
const area = (r) => Math.abs(signed(r));
const oneWay = (r) => (signed(r) < 0 ? r.slice().reverse() : r);
const centre = (r) => [
  r.reduce((s, p) => s + p[0], 0) / r.length,
  r.reduce((s, p) => s + p[1], 0) / r.length,
];
const dot = ([x, y]) =>
  Array.from({ length: 12 }, (_, k) => [
    x + Math.cos(k / 2) * 2,
    y + Math.sin(k / 2) * 2,
  ]);
// 180 degrees about the glyph's centre (480, -480).
const halfTurned = (r) => r.map(([x, y]) => [960 - x, -960 - y]);

// The run of a ring on one side of the cut, with the exact crossing points at its ends.
function side(r, left) {
  const n = r.length;
  const cut = left ? CUT_LEFT : CUT_RIGHT;
  const inSide = (i) => (left ? r[i][0] < cut : r[i][0] >= cut);
  let s = 0;
  while (!(inSide(s) && !inSide((s - 1 + n) % n))) s = (s + 1) % n;
  const cross = (a, b) => [
    cut,
    a[1] + ((b[1] - a[1]) * (cut - a[0])) / (b[0] - a[0]),
  ];
  const out = [cross(r[(s - 1 + n) % n], r[s])];
  let i = s;
  while (inSide(i)) {
    out.push(r[i]);
    i = (i + 1) % n;
  }
  out.push(cross(r[(i - 1 + n) % n], r[i]));
  return out;
}

// One half of the cloud's outline as a C-shaped band, like an arrow: outer edge, then inner edge back.
function band(outerEdge, innerEdge, left) {
  const o = side(outerEdge, left);
  const i = side(innerEdge, left);
  const oDown = o[0][1] < o[o.length - 1][1];
  const iDown = i[0][1] < i[i.length - 1][1];
  return oneWay([...o, ...(oDown === iDown ? i.slice().reverse() : i)]);
}

const round = (v) => Math.round(v * 10) / 10;
const flat = (ring) => ring.flatMap(([x, y]) => [round(x), round(y)]);

// Both ends of flubber's matching of two rings, as flat x,y lists of equal length.
function pair(from, to) {
  const fn = interpolate(from, to, {
    string: false,
    maxSegmentLength: MAX_SEGMENT,
  });
  return { from: flat(fn(0)), to: flat(fn(1)) };
}

// Two outlines sorted left to right.
const leftFirst = (rings) => rings.sort((a, b) => centre(a)[0] - centre(b)[0]);

// Each sync arrow into the arrow on its side, then the "!" bar and dot each from
// a point at its own centre. Turned half a turn, each arrow takes the other side's.
function syncProblemSets(arrows) {
  const [arrowL, arrowR, bar, exDot] = outlineRings(SYNC_PROBLEM_PATH)
    .map(oneWay)
    .sort((a, b) => area(b) - area(a));
  const [left, right] = leftFirst([arrowL, arrowR]);
  const grow = (part) => pair(dot(centre(part)), part);
  const upright = [
    pair(arrows[0], left),
    pair(arrows[1], right),
    grow(bar),
    grow(exDot),
  ];
  const halfTurn = [
    pair(arrows[0], halfTurned(right)),
    pair(arrows[1], halfTurned(left)),
    grow(halfTurned(bar)),
    grow(halfTurned(exDot)),
  ];
  return { upright, halfTurn };
}

export function buildMorphData() {
  const arrows = leftFirst(outlineRings(SYNC_PATH)).map(oneWay);
  const [outerEdge, innerEdge, check] = outlineRings(CLOUD_DONE_PATH)
    .filter((r) => area(r) > 100)
    .sort((a, b) => area(b) - area(a))
    .map(oneWay);
  const left = band(outerEdge, innerEdge, true);
  const right = band(outerEdge, innerEdge, false);
  const arrowsAndDot = [arrows[0], arrows[1], dot(centre(check))];
  // Turned half a turn the cloud is upside down, so each arrow takes the other side's half.
  const upright = [left, right, check];
  const turned = [right, left, check].map(halfTurned);
  const problem = syncProblemSets(arrows);
  return {
    SYNC_PATH,
    CLOUD_DONE_PATH,
    SYNC_PROBLEM_PATH,
    CLOUD_DONE_UPRIGHT: arrowsAndDot.map((r, i) => pair(r, upright[i])),
    CLOUD_DONE_HALF_TURN: arrowsAndDot.map((r, i) => pair(r, turned[i])),
    SYNC_PROBLEM_UPRIGHT: problem.upright,
    SYNC_PROBLEM_HALF_TURN: problem.halfTurn,
  };
}

function render(data) {
  const lines = [
    '// Generated by `npm run morph:build` (scripts/build_sync_morph.mjs). Do not edit.',
    '',
    'export type MorphPair = { from: number[]; to: number[] };',
    '',
    ...Object.entries(data).map(
      ([name, value]) =>
        `export const ${name}${typeOf(value)} = ${JSON.stringify(value)};`
    ),
  ];
  return lines.join('\n') + '\n';
}
const typeOf = (value) =>
  typeof value === 'string' ? ': string' : ': MorphPair[]';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const source = render(buildMorphData());
  const config = await resolveConfig(OUT);
  writeFileSync(OUT, await format(source, { ...config, filepath: OUT }));
  console.log(`wrote ${OUT}`);
}
