import { isFullViewShow, type FullViewShow } from './popOut';

// KAN-624. The worker tells only a focused full view about the run; an opening one resumes it itself.
export type AddressShow = Exclude<FullViewShow, 'run'>;

// The request a new full view was opened with, taken off its address so a reload does not ask again.
export function takeShowFromAddress(): AddressShow | null {
  const params = new URLSearchParams(window.location.search);
  const show = params.get('show');
  if (show === null) return null;
  params.delete('show');
  history.replaceState(
    null,
    '',
    `${window.location.pathname}?${params.toString()}`
  );
  return isFullViewShow(show) && show !== 'run' ? show : null;
}
