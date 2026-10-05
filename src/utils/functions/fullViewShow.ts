import { isFullViewShow, type FullViewShow } from './popOut';

// The request a new full view was opened with, taken off its address so a reload does not ask again.
export function takeShowFromAddress(): FullViewShow | null {
  const params = new URLSearchParams(window.location.search);
  const show = params.get('show');
  if (show === null) return null;
  params.delete('show');
  history.replaceState(
    null,
    '',
    `${window.location.pathname}?${params.toString()}`
  );
  return isFullViewShow(show) ? show : null;
}
