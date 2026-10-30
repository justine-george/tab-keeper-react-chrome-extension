import type { RenderWithProvidersResult } from '../setup/renderWithProviders';
import {
  closeFullViewCallout,
  closePinGuide,
  closeReplayNote,
  closeSetup,
  openFullViewCallout,
  openPinGuide,
  openReplayNote,
  openSetup,
  runShownHere,
  runStoppedHere,
  setFirstSavePopping,
} from '../../redux/slices/globalStateSlice';

type Store = RenderWithProvidersResult['store'];

// Every cover hasPageCover knows: its name, how it opens, how it closes.
export const PAGE_COVERS: [string, (s: Store) => void, (s: Store) => void][] = [
  [
    'the pin guide',
    (s) => s.dispatch(openPinGuide()),
    (s) => s.dispatch(closePinGuide()),
  ],
  ['setup', (s) => s.dispatch(openSetup()), (s) => s.dispatch(closeSetup())],
  [
    'the replay note',
    (s) =>
      s.dispatch(
        openReplayNote({
          leadsToSetup: false,
          leadsToEnding: false,
          isAfterHelpTour: false,
        })
      ),
    (s) => s.dispatch(closeReplayNote()),
  ],
  [
    'the first-save pop',
    (s) => s.dispatch(setFirstSavePopping(true)),
    (s) => s.dispatch(setFirstSavePopping(false)),
  ],
  [
    'the full-view callout',
    (s) => s.dispatch(openFullViewCallout()),
    (s) => s.dispatch(closeFullViewCallout()),
  ],
  [
    'a run here',
    (s) => s.dispatch(runShownHere()),
    (s) => s.dispatch(runStoppedHere()),
  ],
];
