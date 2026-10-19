// corner-shape (CSS Borders 4): Chrome draws it from 139; csstype 3.1, which
// React's style prop is typed by, predates it (KAN-693).
import 'csstype';

declare module 'csstype' {
  // A merge must repeat csstype's type parameters, by name, unused here.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface StandardLonghandProperties<TLength, TTime> {
    cornerShape?:
      | 'round'
      | 'scoop'
      | 'bevel'
      | 'notch'
      | 'square'
      | 'squircle'
      | `superellipse(${number})`;
  }
}
