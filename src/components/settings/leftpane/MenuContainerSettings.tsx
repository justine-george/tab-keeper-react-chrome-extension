import { useDispatch } from 'react-redux';

import Icon from '../../common/Icon';
import ClickableRow from '../../common/ClickableRow';
import {
  BACK_GLYPH_SHIFT_PX,
  BACK_LABEL_GAP,
  HEADER_BACK_TARGET,
  headerBackFillCss,
} from '../../common/headerBackTarget';
import { hoverMotionCss } from '../../common/hoverMotion';
import { NormalLabel } from '../../common/Label';
import { AppDispatch } from '../../../redux/store';
import { useThemeColors } from '../../../hooks/useThemeColors';
import {
  closeSettingsPage,
  closeAllToasts,
} from '../../../redux/slices/globalStateSlice';
import { useTranslation } from 'react-i18next';
import { DURATION, TYPE } from '../../../styles/scale';

// The Settings header card's centre less this row's (34 - 29), measured.
const BACK_TO_HEADER_CENTRE_PX = 5;

export default function MenuContainer() {
  const COLORS = useThemeColors();
  const { t } = useTranslation();

  const containerStyle = `
    display: flex;
    justify-content: space-around;
    align-items: center;
    ${HEADER_BACK_TARGET}
    ${headerBackFillCss(COLORS)}
    /* KAN-721 (his demo pick). On the Settings header's centre line: that card
       is centred 34px down (8px pane padding, 1px, half its 50px), this row 29px
       (1px, half its 56px). Moved, not laid out again, so the menu box below
       keeps its KAN-239 top; the fill moves with the label. */
    top: ${BACK_TO_HEADER_CENTRE_PX}px;
    ${hoverMotionCss({
      translate: `${-BACK_GLYPH_SHIFT_PX}px`,
      duration: DURATION.MOVE,
    })}
  `;

  const dispatch: AppDispatch = useDispatch();

  const handleBackClick = () => {
    dispatch(closeSettingsPage());
    dispatch(closeAllToasts());
  };

  return (
    <ClickableRow
      ariaLabel={t('Go back')}
      tooltipText={t('Go back')}
      onClick={handleBackClick}
      style={containerStyle}
    >
      <Icon
        type="arrow_back"
        style={`margin-left: ${BACK_GLYPH_SHIFT_PX}px; margin-right: ${-BACK_GLYPH_SHIFT_PX}px;`}
      />
      <NormalLabel
        value={t('Back')}
        size={TYPE.SECTION}
        color={COLORS.TEXT_COLOR}
        style={`padding-left: ${BACK_LABEL_GAP}; cursor: pointer;`}
      />
    </ClickableRow>
  );
}
