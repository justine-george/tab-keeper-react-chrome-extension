export interface SettingsCategory {
  name: string;
  isSelected: boolean;
}

export interface SettingsDetailsContainerProps {
  settingsCategoryList: SettingsCategory[];
}
