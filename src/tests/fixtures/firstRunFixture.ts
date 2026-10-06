import { newRun, type FirstRun } from '../../utils/functions/firstRun';

// A profile that finished its full-view run and saw What's new, so no open starts a run in a test about something else.
export const RUN_FINISHED: FirstRun = {
  ...newRun('full', 8),
  ended: 'finished',
};

export const RUN_FINISHED_SETTINGS = {
  isWhatsNew2Seen: true,
  firstRun: RUN_FINISHED,
};
