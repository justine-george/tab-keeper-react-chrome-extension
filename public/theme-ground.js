// The stored theme's ground on the first frame; useDocumentTheme takes over at mount.
(function () {
  var GROUNDS = {
    Light: '#F5F7FA',
    WarmLight: '#F8F3E8',
    BBPink: '#FCEEF3',
    Darkenheimer: '#2A2A2A',
    Blue: '#2A2A3A',
    Chalk: '#FFFFFF',
    Charcoal: '#18191A',
  };
  var MOVES = { Light: 'Chalk', Darkenheimer: 'Charcoal' };
  var theme;
  try {
    var parsed = JSON.parse(localStorage.getItem('settingsData') || '{}');
    theme = parsed && parsed.theme;
    // KAN-731. Twin of the slice's Chalk/Charcoal move (src/redux/slices/settingsDataStateSlice.ts).
    if (
      Object.prototype.hasOwnProperty.call(MOVES, theme) &&
      parsed.isChalkCharcoalMoveApplied !== true
    ) {
      theme = MOVES[theme];
    }
  } catch (e) {
    theme = undefined;
  }
  var ground =
    typeof theme === 'string' &&
    Object.prototype.hasOwnProperty.call(GROUNDS, theme)
      ? GROUNDS[theme]
      : // KAN-829. Twin of defaultTheme() in src/utils/constants/theme.ts.
        GROUNDS.Chalk;
  document.documentElement.style.setProperty('--app-background', ground);
})();
