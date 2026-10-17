import { TYPE } from '../../styles/scale';
import { isTabView } from '../../utils/functions/viewMode';

// KAN-654. Setup and the cloud question take a title-size title in the full view; padding stays 20px in both (round 6).
export function dialogTier(): { pad: number; title: string } {
  return isTabView()
    ? { pad: 20, title: TYPE.TITLE }
    : { pad: 20, title: TYPE.SECTION };
}
