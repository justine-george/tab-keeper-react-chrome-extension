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

// textbox placeholders
export const TEXTBOX_PLACEHOLDERS = {
  EMAIL: 'Email Address',
  PASSWORD: 'Password',
  CONFIRM_PASSWORD: 'Confirm Password',
};

// error messages
export const TOAST_MESSAGES = {
  INVALID_EMAIL: 'Please enter a valid email address.',
  INVALID_PASSWORD:
    'Your password must be at least 8 characters long and contain both letters and numbers.',
  PASSWORD_MISMATCH:
    'The passwords you entered do not match. Please try again.',
  ACCOUNT_CREATION_SUCCESS: 'Account created successfully!',
  ACCOUNT_CREATION_FAIL:
    'There was an issue creating your account. Please try again later.',
  LOGIN_FAIL:
    "Sorry, we couldn't log you in. Please check your credentials and try again.",
  PASSWORD_RESET_SUCCESS:
    "We've sent you a password reset link. Check your inbox and follow the instructions.",
  PASSWORD_RESET_FAIL:
    'Oops! Something went wrong while sending the reset link. Please try again later.',
  LOGOUT_SUCCESS: 'You have successfully logged out.',
  LOGOUT_FAIL:
    'Oops! We encountered an issue while logging you out. Please try again.',
  // Two messages rather than one "Session saved.", because the two save
  // buttons sit next to each other and look alike: the toast is the only
  // thing that tells the user which of them ran (KAN-5).
  //
  // Neither may be "Current window saved." -- that is
  // ADD_CURR_WINDOW_TO_TABGROUP_SUCCESS below, a different operation (it adds
  // a window to the already-selected session rather than creating one).
  SAVE_ALL_WINDOWS_SUCCESS: 'All open windows saved as a session.',
  SAVE_CURRENT_WINDOW_SUCCESS: 'Current window saved as a session.',
  ADD_CURR_WINDOW_TO_TABGROUP_SUCCESS: 'Current window saved.',
  ADD_CURR_TAB_TO_WINDOW_SUCCESS: 'Current tab saved.',
  DELETE_TAB_CONTAINER_SUCCESS: 'Session deleted.',
  DELETE_WINDOW_SUCCESS: 'Session window deleted.',
  DELETE_TAB_SUCCESS: 'Session tab deleted.',
  UNREADABLE_ACCOUNT_TOKEN:
    'Sync unavailable: your saved account token could not be read.',
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

export const TOOLTIP_MESSAGES = {
  EMAIL: 'Enter your email address',
  PASSWORD: 'Enter your password',
  NEW_ACCOUNT_EMAIL: 'Enter your preferred email address',
  NEW_ACCOUNT_PASSWORD:
    'Password must be at least 8 characters long and contain both letters and numbers',
  NEW_ACCOUNT_CONFIRM_PASSWORD: 'Re-enter your password to confirm it',
};
