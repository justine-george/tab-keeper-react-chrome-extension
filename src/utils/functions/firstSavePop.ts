// KAN-875. The first save's pop (V4, round 2): 12 disks at even angles and 12 bits between them.

export interface PopPiece {
  kind: 'disk' | 'bit';
  // Where it stops, from the save button's centre, in px.
  dx: number;
  dy: number;
  // How far it tumbles on the way, in turns.
  turn: number;
  width: number;
  height: number;
  colour: string;
}

// The mark's (TabKeeperMark): its body, and the tile's mints and stripes' coppers.
export const DISK_COLOUR = '#445562';
const BIT_COLOURS = ['#99bf9d', '#7fa884', '#d09263', '#e3b98f'];

const COUNT = 12;
const STEP = 360 / COUNT;
const DISK_SIZE = 14;

const piece = (
  kind: PopPiece['kind'],
  degrees: number,
  distance: number,
  rest: Omit<PopPiece, 'kind' | 'dx' | 'dy'>
): PopPiece => {
  const radians = (degrees * Math.PI) / 180;
  return {
    kind,
    dx: Math.cos(radians) * distance,
    dy: Math.sin(radians) * distance,
    ...rest,
  };
};

// `random` is Math.random in the app; tests hand it a fixed sequence.
export function popPieces(random: () => number): PopPiece[] {
  const between = (low: number, high: number) => low + random() * (high - low);
  const disks = Array.from({ length: COUNT }, (_, i) =>
    piece('disk', i * STEP + between(-10, 10), between(70, 90), {
      turn: between(-0.5, 0.5),
      width: DISK_SIZE,
      height: DISK_SIZE,
      colour: DISK_COLOUR,
    })
  );
  const bits = Array.from({ length: COUNT }, (_, i) =>
    piece('bit', i * STEP + STEP / 2, between(55, 75), {
      turn: between(-1, 1),
      width: between(5, 8),
      height: between(8, 12),
      colour: BIT_COLOURS[i % BIT_COLOURS.length],
    })
  );
  return [...disks, ...bits];
}
