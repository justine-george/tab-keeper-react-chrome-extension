import { useSelector } from 'react-redux';

import { RootState } from '../../redux/store';
import { isDarkTheme } from '../../hooks/useThemeColors';

// A plain magnifier on a faint disc; the colour is the caller's, as currentColor.
export default function NoMatchArt() {
  const isDark = useSelector((state: RootState) =>
    isDarkTheme(state.settingsDataState.theme)
  );

  return (
    <svg
      width="4.5rem"
      height="4.5rem"
      viewBox="0 0 72 72"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', flexShrink: 0, marginBottom: 4 }}
    >
      <circle
        cx="36"
        cy="36"
        r="34"
        fill="currentColor"
        opacity={isDark ? 0.14 : 0.12}
      />
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        <circle cx="32" cy="32" r="13" strokeWidth="2.5" />
        <path d="M41.5 41.5 L52 52" strokeWidth="3.5" />
      </g>
    </svg>
  );
}
