# Tab Keeper - Chrome Tab Manager & Sync Tool

<a href="https://chromewebstore.google.com/detail/tab-keeper-chrome-tab-man/gpibgniomobngodpnikhheifblbpbbah?ref=github" target="_blank"><img src="store-assets/marquee promo tile/tab-keeper-marquee-promo-tile.png" alt="Tab Keeper — save your tabs, pick up anytime, now with Chrome tab group support"></a>

Tab Keeper saves your open Chrome windows and tabs as organized sessions. Restore them later—including tab group names and colors—and sync them across desktop Chrome without creating an account or providing an email address.

[![Featured on the Chrome Web Store](https://img.shields.io/badge/Featured_on-Chrome_Web_Store-cce7e8?style=for-the-badge)](https://chromewebstore.google.com/detail/tab-keeper-chrome-tab-man/gpibgniomobngodpnikhheifblbpbbah?ref=github)
[![Current version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fjustine-george%2Ftab-keeper-react-chrome-extension%2Fmain%2Fpackage.json&query=version&style=for-the-badge&label=Version)](#changelog)
![Tab Keeper users](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fjustine-george%2Fjgeorge.com%2Fmain%2Fsrc%2Fdata%2Fextension-metrics.json&query=%24.tabKeeper.users&style=for-the-badge&label=Users)
[![MIT license](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](https://raw.githubusercontent.com/justine-george/tab-keeper-react-chrome-extension/main/LICENSE)

<a href="https://chromewebstore.google.com/detail/tab-keeper-chrome-tab-man/gpibgniomobngodpnikhheifblbpbbah?ref=github" target="_blank"><img src="store-assets/banners/chrome_web_store_download_button.png" width="300" alt="Get Tab Keeper from the Chrome Web Store"></a>

## Features

- **Save & Restore:** Save all your open windows and tabs as a session, then reopen them later.
- **Tab Groups:** Preserve Chrome tab groups, including their names and colors.
- **One-Click Switching:** Jump to a saved session while Tab Keeper safely saves your current windows first.
- **Device Sync:** Access your sessions from Chrome desktop browsers connected to the same Chrome profile.
- **Privacy First:** No email address, account setup, or signup required.
- **Quick Search:** Find any saved tab as you type.
- **Multi-Language Support:** Use Tab Keeper in 10 languages.
- **Custom Themes:** Choose from five light and dark themes.

## How It Works

1. Open Tab Keeper and save your current window or all open windows.
2. Search and organize your saved sessions.
3. Restore a session later, or switch sessions while saving your current windows first.

## Screenshots

<a href="https://chromewebstore.google.com/detail/tab-keeper-chrome-tab-man/gpibgniomobngodpnikhheifblbpbbah?ref=github" target="_blank"><img src="store-assets/screenshots/tab-keeper-screenshot-2.png" width="800" alt="Tab Keeper showing saved browser sessions and their tabs"></a>

[View All Screenshots →](https://github.com/justine-george/tab-keeper-react-chrome-extension/wiki/Screenshots)

## Privacy & Sync

Tab Keeper does not require an email address or a user-created account. It generates an anonymous identifier that Chrome syncs with your browser profile.

Your sessions are stored locally on your device. When device sync is enabled, saved session data—including tab URLs and titles—is sent to cloud storage so you can access it from other desktop Chrome browsers connected to the same profile.

## Changelog

### v.1.6.0 (Latest)

#### Features

- Saved sessions now keep your Chrome tab groups, with their names and colors, and restore them the same way
- Tab group support asks for its extra permission only when you have tab groups to save, and works without it otherwise

#### Fixes

- Undoing a session you just created is no longer brought back by the next sync
- Undo no longer reports that changes arrived from another device when nothing did
- A session can no longer be saved or renamed to an empty title and left nameless
- Session dates now follow your own language and region instead of always being English and US-formatted
- Error messages and the empty-session text now appear in your own language, and a mistyped German label is corrected
- Clearing the search box no longer jumps you to a session you were not looking at
- A cloud copy the app cannot read is now explained instead of leaving the sync icon in an error state with no reason given
- The sync icon no longer offers to sync when your device and the cloud already agree
- Dialogs now keep keyboard focus inside them, so Tab can no longer reach the page behind
- The rating prompt can now be dismissed with the keyboard, and its button no longer wraps in most languages
- A session's title can now be renamed with the keyboard
- Buttons that show only an icon now show a pointer cursor
- Settings now marks which theme is active, and its switches say what they control
- Hovering a session no longer makes it look selected
- Hovering the selected settings category no longer makes it look unselected
- The second session in the list no longer flashes when a new session is created
- A session row's buttons and its highlight now appear together instead of one without the other
- A session row now fills evenly when you point at it, with no visible edge where the buttons begin
- The divider between saved sessions no longer disappears behind the action buttons
- The highlight on a session's action buttons no longer sits flush against the row's edge on some rows and not others

#### Improvements

- The app no longer makes failing cloud requests while it is still signing in

### v.1.5.0

#### Features

- Save just the current window as a session, instead of always saving every open window
- Every button, list row and menu item can now be reached with Tab and used with Enter or Space
- Screen readers now announce every control correctly, and in your own language rather than in English
- Disabled controls are no longer focusable, and are announced as disabled instead of as ordinary buttons

#### Fixes

- Renaming a session no longer loses what you have typed when a sync or an undo arrives while you are editing
- An undone rename no longer reappears on the next sync
- Redo now works on macOS, where the Cmd+Shift+Z shortcut previously did nothing at all
- Cmd+Z inside a text field now undoes your typing instead of the app's last action
- Typing in the search box no longer clears the redo history or floods the undo history
- Search results now report how many matches were found, instead of repeating the session's own window and tab counts
- Sessions are now ordered and dated by the instant they were created, so their order no longer depends on the device's clock
- The focus-mode confirmation no longer says your windows are "already saved" when there was nothing to save
- Focus mode no longer saves popup windows that it cannot reopen later
- A session too large to sync is now refused with an explanation, instead of leaving sync stuck for good
- Selecting or searching a session no longer changes when that session was last modified, which could let an older copy win a sync
- The message shown when a sync fails now appears in your own language
- The area around the app now follows your chosen theme instead of staying grey
- Icon spacing inside buttons now renders as intended

#### Improvements

- Selecting or searching a session no longer triggers a cloud sync

### v.1.4.1

#### Fixes

- Search results now show a window's own title when only its tabs match, instead of borrowing the title of one of those tabs
- Collapsing or renaming a window no longer affects the wrong row after a window or tab is added to a session
- Switching themes now applies the new colors immediately instead of fading through the old ones, and the scrollbar changes with them
- The Auto Sync button no longer flashes as you move between settings sections
- A backup too large to sync is now refused when you restore it, with an explanation, instead of being loaded and leaving sync stuck
- Restoring a backup now tells you when it could not be saved to the cloud, instead of always reporting success
- Restoring a backup saved by an older version no longer fails to sync on its first attempt

#### Improvements

- Dependent packages updated to latest versions

[View All Changelog →](https://github.com/justine-george/tab-keeper-react-chrome-extension/wiki/Changelog)

## Blog Posts

[View All Posts →](https://github.com/justine-george/tab-keeper-react-chrome-extension/wiki/Blog-Posts)

## Development and Contributing

Contributions are welcome! Feel free to open issues or submit pull requests following the established coding style and guidelines.

Install the dependencies and create a production build:

```sh
npm install
npm run build
```

To try the extension locally, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the generated `dist` directory.

Run `npm test` for the unit and component suites, and `npm run test:e2e` for the browser tests against a real build ([details](e2e/README.md)).

## Built With

[React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Redux Toolkit](https://redux-toolkit.js.org/), [Vite](https://vitejs.dev/), [Firebase](https://firebase.google.com/), [Vitest](https://vitest.dev/), [Playwright](https://playwright.dev/), [Emotion](https://emotion.sh/), and [react-i18next](https://react.i18next.com/).

## License

Tab Keeper is released under the [MIT License](https://raw.githubusercontent.com/justine-george/tab-keeper-react-chrome-extension/main/LICENSE).

## Support

Report bugs or request features via [GitHub Issues](https://github.com/justine-george/tab-keeper-react-chrome-extension/issues).
