// Becomes the full view the moment it is shown: a click, the full-view button focusing it, or Chrome reloading a discarded stub.
(function () {
  function open() {
    location.replace('/index.html?view=tab');
  }
  if (document.visibilityState === 'visible') {
    open();
    return;
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') open();
  });
})();
