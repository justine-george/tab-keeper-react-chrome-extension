import manifest from '../../../public/manifest.json';

// Constants related to colors moved to hook/useThemeColors

// for plain icons with no interactivity
export const NON_INTERACTIVE_ICON_STYLE =
  'cursor: unset; &:hover {background-color: unset;}';

// app container dimensions
export const APP_HEIGHT = '550px';
export const APP_WIDTH = '790px';

// default dimensions for a new window
export const DEFAULT_WINDOW_HEIGHT: number = Math.round(
  window.screen.height * 0.9
);
export const DEFAULT_WINDOW_WIDTH: number = Math.round(
  window.screen.width * 0.8
);
export const DEFAULT_WINDOW_OFFSET_TOP: number = Math.round(
  (window.screen.height - DEFAULT_WINDOW_HEIGHT) / 2
);
export const DEFAULT_WINDOW_OFFSET_LEFT: number = Math.round(
  (window.screen.width - DEFAULT_WINDOW_WIDTH) / 2
);

// max undo stack size
export const STACK_LEVEL = 15;

// debounce window
export const DEBOUNCE_TIME_WINDOW = 500;

// app version
export const APP_VERSION = manifest.version;

// developer details
// The Web Store listing, tagged so an install arriving from an exported file
// can be told apart from one arriving from the README (KAN-190). The README
// links use ?ref=github for the same reason.
export const EXPORT_STORE_URL =
  'https://chromewebstore.google.com/detail/tab-keeper-chrome-tab-man/gpibgniomobngodpnikhheifblbpbbah?ref=export';

// developer email
export const DEV_EMAIL = 'justinegeo96@gmail.com';

// KAN-259. The policy lives in the repository (KAN-257), so the link is to
// the file on main and its history is the change log.
export const PRIVACY_POLICY_LINK =
  'https://github.com/justine-george/tab-keeper-react-chrome-extension/blob/main/PRIVACY.md';

export const APP_CHROME_WEBSTORE_LINK =
  'https://chromewebstore.google.com/detail/tab-keeper-chrome-tab-man/gpibgniomobngodpnikhheifblbpbbah';

// X share intent.
//
// x.com/intent/POST, not twitter.com/intent/tweet: the old host answers 301 to
// exactly this URL, so every share cost a redirect, and `tweet` is the endpoint
// name X itself has retired. Both still resolve today; neither is worth
// depending on once the button says X.
export const SHARE_X_TEXT = `https://x.com/intent/post?text=Tab%20Keeper%20-%20Chrome%20Extension&hashtags=TabKeeper&url=${APP_CHROME_WEBSTORE_LINK}`;

// feedback mail subject
export const FEEDBACK_MAIL_SUBJECT = `Feedback: Tab Keeper v${APP_VERSION}`;

// error messages
//
// Every entry here SHIPS, whether or not anything displays it: this is one
// object literal imported by live code, and tree-shaking drops unreferenced
// bindings, not object properties. That is why the credential-screen messages
// were bytes in every user's bundle long after the screens became unreachable,
// and why they were deleted with those screens rather than left "harmlessly"
// in place (KAN-69).
export const TOAST_MESSAGES = {
  // Two messages rather than one "Session saved.", because the two save
  // buttons sit next to each other and look alike: the toast is the only
  // thing that tells the user which of them ran (KAN-5).
  //
  // Neither may be "Current window saved." -- that is
  // ADD_CURR_WINDOW_TO_TABGROUP_SUCCESS below, a different operation (it adds
  // a window to the already-selected session rather than creating one).
  SAVE_ALL_WINDOWS_SUCCESS: 'All open windows saved as a session.',
  SAVE_CURRENT_WINDOW_SUCCESS: 'Current window saved as a session.',
  // KAN-209. Reuses the key the export page's inline note already uses, rather
  // than adding a second string for the same event -- it is already translated
  // in all ten locales, and two wordings for one outcome is how "Links copied"
  // and "Links copied." end up side by side.
  COPY_LINKS_SUCCESS: 'Links copied',
  // "added", not "saved". These two report putting something into a session
  // that already exists, which is a different operation from the two above --
  // and the right pane's button now says "Add to this session", so a toast
  // saying "saved" would contradict the control the user just pressed.
  ADD_CURR_WINDOW_TO_TABGROUP_SUCCESS: 'Current window added to this session.',
  ADD_CURR_TAB_TO_WINDOW_SUCCESS: 'Current tab added to this window.',
  // KAN-151. Applying a sort overwrites every rank, so a hand-arranged list is
  // gone in one click. Undo restores it -- sorting goes on the undo stack like
  // any other data change -- but nothing said so, and "my arrangement is gone"
  // is not a thought that leads anyone to press undo.
  //
  // The instruction is only worth printing because it is TRUE: a test asserts
  // the dragged order really does come back with one undo, so this cannot decay
  // into a false promise without something going red.
  SESSION_ORDER_CHANGED:
    'Sessions reordered. Undo to restore the previous order.',
  DELETE_TAB_CONTAINER_SUCCESS: 'Session deleted.',
  DELETE_WINDOW_SUCCESS: 'Session window deleted.',
  DELETE_TAB_SUCCESS: 'Session tab deleted.',
  UNREADABLE_ACCOUNT_TOKEN:
    'Sync unavailable: your saved account token could not be read.',
  // The refusal it reports is deliberate: an unparseable cloud document may be
  // a NEWER FORMAT rather than corruption, so the sync stops instead of
  // overwriting it. Without a toast the only signals are the header glyph and
  // a console.warn, and the glyph cannot answer the question a user actually
  // has - whether their sessions are at risk. They are not, so say so (KAN-72).
  //
  // No "try again" instruction, unlike the over-limit message: retrying is not
  // the remedy and there may be no user-side remedy at all. A false
  // instruction would be worse than none.
  UNREADABLE_CLOUD_DOCUMENT:
    'Sync unavailable: your cloud data could not be read. Sessions on this device are safe.',
  // Shown only when a merge actually brought something new to this device.
  // Divergence between devices used to be visible as a blocking prompt; this
  // replaces it with a notification, and stays silent when the merge is a
  // no-op, which is the common case.
  SYNC_MERGED: 'Synced changes from another device.',
  // KAN-254. Both halves matter: the document is gone, and this device will
  // not write it back -- the user is told the second so they do not wonder
  // why a setting changed under them.
  CLOUD_DATA_DELETED: 'Cloud data deleted. Auto Sync is off on this device.',
  CLOUD_DATA_DELETE_FAILED:
    "Couldn't delete cloud data. Check your connection and try again.",
  IMPORT_SUCCESS: 'Restored tabs successfully!',
  // Deliberately not "Error restoring tabs": by the time the cloud write is
  // attempted the restore has already succeeded on this device, so telling the
  // user it failed would be as wrong as the success toast this replaces
  // (KAN-43). isDirty stays set, so the next sync retries the write.
  IMPORT_SYNC_FAILED: 'Restored on this device, but syncing failed.',
};

// The frame an import failure is reported in, with the reason as {{detail}}
// (KAN-86). An opaque key rather than an English sentence, matching the
// convention every other interpolating string here follows.
//
// It is not part of TOAST_MESSAGES because every entry there is a complete
// message that Toast can render on its own; this one is incomplete without
// its parameter, and putting it in that object would invite it being
// dispatched bare.
export const IMPORT_ERROR_FRAME = 'ImportErrorFrame';
