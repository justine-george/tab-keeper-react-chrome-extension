import { useSelector } from "react-redux";
import { RootState } from "../../utils/store";

export function useThemeColors() {
  const settingsData = useSelector((state: RootState) => state.settingsState);

  return settingsData.isDarkMode
    ? {
        PRIMARY_COLOR: "#1F1F1F",
        SECONDARY_COLOR: "#353535",
        SELECTION_COLOR: "#575757",
        HOVER_COLOR: "#353535",
        ICON_HOVER_COLOR: "#000000",
        DELETE_ICON_HOVER_COLOR: "#FF5733",
        LABEL_L3_COLOR: "#7F7F7F",
        LABEL_L1_COLOR: "#D2D2D2",
        LABEL_L2_COLOR: "#B5B5B5",
        TAG_BG_COLOR: "#2C2C2C",
        TAG_BORDER_COLOR: "#3F3F3F",
        BORDER_COLOR: "#FFFFFF",
        TEXT_COLOR: "#FFFFFF",
      }
    : {
        PRIMARY_COLOR: "#E0E0E0",
        SECONDARY_COLOR: "#CACACA",
        SELECTION_COLOR: "#A8A8A8",
        HOVER_COLOR: "#CACACA",
        ICON_HOVER_COLOR: "#FFFFFF",
        DELETE_ICON_HOVER_COLOR: "#FF5733",
        LABEL_L3_COLOR: "#808080",
        LABEL_L1_COLOR: "#2D2D2D",
        LABEL_L2_COLOR: "#4A4A4A",
        TAG_BG_COLOR: "#D3D3D3",
        TAG_BORDER_COLOR: "#C0C0C0",
        BORDER_COLOR: "#000000",
        TEXT_COLOR: "#000000",
      };
}
