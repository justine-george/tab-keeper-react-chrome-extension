import { TYPE } from '../../styles/scale';
import { isTabView } from '../../utils/functions/viewMode';

// KAN-654, KAN-921. Every dialog takes a title-size title in the full view.
export function dialogTitleSize(): string {
  return isTabView() ? TYPE.TITLE : TYPE.SECTION;
}
