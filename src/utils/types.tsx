import { Global as GlobalStateType } from "../redux/slice/globalStateSlice";
import { SettingsData as SettingsDataStateType } from "../redux/slice/settingsDataStateSlice";
import { SettingsCategory as SettingsCategoryStateType } from "../redux/slice/settingsCategoryStateSlice";
import { tabContainerData as TabContainerDataStateType } from "../redux/slice/tabContainerDataStateSlice";

export interface IndividualStates {
  globalState: GlobalStateType;
  settingsDataState: SettingsDataStateType;
  settingsCategoryState: SettingsCategoryStateType[];
  tabContainerDataState: TabContainerDataStateType[];
}
