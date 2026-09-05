import manifest from '../../../public/manifest.json';
import { Language } from '../../redux/slices/settingsDataStateSlice';

// Constants related to colors moved to hook/useThemeColors

// for plain icons with no interactivity
export const NON_INTERACTIVE_ICON_STYLE =
  'cursor: unset; &:hover {background-color: unset;}';

// default language
export const DEFAULT_LANG = Language.EN;

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
export const DEV_CREDITS = `Crafted with ❤️ by Justine George`;

// developer email
export const DEV_EMAIL = 'justinegeo96@gmail.com';

export const APP_CHROME_WEBSTORE_LINK =
  'https://chromewebstore.google.com/detail/tab-keeper-chrome-tab-man/gpibgniomobngodpnikhheifblbpbbah';

// twitter (X) share text
export const SHARE_TWITTER_TEXT = `https://twitter.com/intent/tweet?text=Tab%20Keeper%20-%20Chrome%20Extension&hashtags=TabKeeper&url=${APP_CHROME_WEBSTORE_LINK}`;

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
  // "added", not "saved". These two report putting something into a session
  // that already exists, which is a different operation from the two above --
  // and the right pane's button now says "Add to this session", so a toast
  // saying "saved" would contradict the control the user just pressed.
  ADD_CURR_WINDOW_TO_TABGROUP_SUCCESS: 'Current window added to this session.',
  ADD_CURR_TAB_TO_WINDOW_SUCCESS: 'Current tab added to this window.',
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
