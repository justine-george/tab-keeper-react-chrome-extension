import { TYPE } from '../../styles/scale';
import { isTabView } from '../../utils/functions/viewMode';

// KAN-654. Setup and the cloud question a size up in the full view, as the review card is; the popup's as they were.
export function dialogTier(): { pad: number; title: string } {
  return isTabView()
    ? { pad: 24, title: TYPE.TITLE }
    : { pad: 20, title: TYPE.SECTION };
}
