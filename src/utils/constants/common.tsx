// Constants related to colors moved to hook/useThemeColors

// for plain icons with no interactivity
export const NON_INTERACTIVE_ICON_STYLE =
  'cursor: unset; &:hover {background-color: unset;}';

// app container dimensions
export const APP_HEIGHT = '550px';
export const APP_WIDTH = '790px';

// max undo stack size
export const STACK_LEVEL = 10;

// debounce window
export const DEBOUNCE_TIME_WINDOW = 500;

// app version
export const APP_VERSION = '1.0.1';

// developer details
export const DEV_CREDITS = 'Made by Justine George.';

// developer email
export const DEV_EMAIL = 'justinegeo96@gmail.com';

export const APP_CHROME_WEBSTORE_LINK =
  'https://chrome.google.com/webstore/detail/tabhound-tab-manager/dhmeglggkjfgbinodfdphenmodhancbd';

// twitter (X) share text
export const SHARE_TWITTER_TEXT = `https://twitter.com/intent/tweet?text=A%20shoutout%20to%20my%20new%20fav%20Chrome%20extension%20%23TabKeeper&url=${APP_CHROME_WEBSTORE_LINK}`;

// feedback mail subject
export const FEEDBACK_MAIL_SUBJECT = `Feedback: Tab Keeper v${APP_VERSION}`;

// feedback request text
export const FEEDBACK_REQUEST = 'Share Your Thoughts';

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
};

export const TOOLTIP_MESSAGES = {
  EMAIL: 'Enter your email address',
  PASSWORD: 'Enter your password',
  NEW_ACCOUNT_EMAIL: 'Enter your preferred email address',
  NEW_ACCOUNT_PASSWORD:
    'Password must be at least 8 characters long and contain both letters and numbers',
  NEW_ACCOUNT_CONFIRM_PASSWORD: 'Re-enter your password to confirm it',
};
