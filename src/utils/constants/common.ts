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
  SAVE_TAB_CONTAINER_SUCCESS: 'Session saved.',
  ADD_CURR_WINDOW_TO_TABGROUP_SUCCESS: 'Current window saved.',
  ADD_CURR_TAB_TO_WINDOW_SUCCESS: 'Current tab saved.',
  DELETE_TAB_CONTAINER_SUCCESS: 'Session deleted.',
  DELETE_WINDOW_SUCCESS: 'Session window deleted.',
  DELETE_TAB_SUCCESS: 'Session tab deleted.',
};

export const TOOLTIP_MESSAGES = {
  EMAIL: 'Enter your email address',
  PASSWORD: 'Enter your password',
  NEW_ACCOUNT_EMAIL: 'Enter your preferred email address',
  NEW_ACCOUNT_PASSWORD:
    'Password must be at least 8 characters long and contain both letters and numbers',
  NEW_ACCOUNT_CONFIRM_PASSWORD: 'Re-enter your password to confirm it',
};
