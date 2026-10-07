// The stored theme's ground on the first frame; useDocumentTheme takes over at mount.
(function () {
  var GROUNDS = {
    Light: '#F5F7FA',
    WarmLight: '#F8F3E8',
    BBPink: '#FCEEF3',
    Darkenheimer: '#2A2A2A',
    Blue: '#2A2A3A',
  };
  var theme;
  try {
    var parsed = JSON.parse(localStorage.getItem('settingsData') || '{}');
    theme = parsed && parsed.theme;
  } catch (e) {
    theme = undefined;
  }
  var ground =
    typeof theme === 'string' &&
    Object.prototype.hasOwnProperty.call(GROUNDS, theme)
      ? GROUNDS[theme]
      : GROUNDS.Light;
  document.documentElement.style.setProperty('--app-background', ground);
})();
