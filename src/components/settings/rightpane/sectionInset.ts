import { ICON } from '../../../styles/scale';
import { isTabView } from '../../../utils/functions/viewMode';

const SIDE_INSET = 'clamp(16px, 8%, 72px)';
// The header's icon box and label gap; its border and padding match the pane's.
const TITLE_TEXT_INSET = `calc(${ICON.DEFAULT} + 12px)`;

// KAN-716. The popup starts under the Settings title; the full view keeps its even indent.
export const sectionInsetCss = (): string => `
  padding-left: ${isTabView() ? SIDE_INSET : TITLE_TEXT_INSET};
  padding-right: ${SIDE_INSET};
`;
