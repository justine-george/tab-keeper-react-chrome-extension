import { useSelector } from 'react-redux';
import { RootState } from '../../redux/store';

export function useThemeColors() {
  const settingsData = useSelector(
    (state: RootState) => state.settingsDataState
  );

  return settingsData.isDarkMode
    ? {
        PRIMARY_COLOR: '#252839',
        SECONDARY_COLOR: '#2C2F3E',
        SELECTION_COLOR: '#383B52',
        HOVER_COLOR: '#343648',
        ICON_HOVER_COLOR: '#1B1D28',
        DELETE_ICON_HOVER_COLOR: '#FF6347',
        LABEL_L3_COLOR: '#6F728A',
        LABEL_L1_COLOR: '#C0C2CE',
        LABEL_L2_COLOR: '#9A9BB2',
        TAG_BG_COLOR: '#292B3C',
        TAG_BORDER_COLOR: '#1E202B',
        BORDER_COLOR: '#DADCE4',
        TEXT_COLOR: '#EDEFF2',
        INVERSE_PRIMARY_COLOR: '#F0F2F5',
      }
    : {
        PRIMARY_COLOR: '#F0F2F5',
        SECONDARY_COLOR: '#E1E4E8',
        SELECTION_COLOR: '#C2C5CC',
        HOVER_COLOR: '#D9DCDF',
        ICON_HOVER_COLOR: '#F5F7FA',
        DELETE_ICON_HOVER_COLOR: '#FF6347',
        LABEL_L3_COLOR: '#74777E',
        LABEL_L1_COLOR: '#2E3136',
        LABEL_L2_COLOR: '#505357',
        TAG_BG_COLOR: '#E9EBED',
        TAG_BORDER_COLOR: '#D4D6D9',
        BORDER_COLOR: '#2E3136',
        TEXT_COLOR: '#1A1B1E',
        INVERSE_PRIMARY_COLOR: '#252839',
      };
}
