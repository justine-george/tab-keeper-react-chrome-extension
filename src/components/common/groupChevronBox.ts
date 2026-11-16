import { ICON } from '../../styles/scale';

// A group's chevron box (Icon's 4px padding round a DEFAULT glyph), pulled in to the
// title row's 32px: at a 20px root it is 38 and overflows evenly, as the row's
// action strip does, instead of growing the row past KAN-360's 32 (KAN-822).
export const GROUP_CHEVRON_BOX_STYLE = `margin-block: min(0px, (32px - ${ICON.DEFAULT} - 8px) / 2);`;
