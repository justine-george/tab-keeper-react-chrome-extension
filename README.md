# Tab Keeper - Session & Tab Manager

<a href="https://chromewebstore.google.com/detail/tab-keeper-chrome-tab-man/gpibgniomobngodpnikhheifblbpbbah?ref=github" target="_blank"><img src="store-assets/marquee promo tile/tab-keeper-marquee-promo-tile.png" alt="Tab Keeper: manage tabs now, keep them for later"></a>

Tab Keeper is a free, open-source session and tab manager for Chrome. It manages the tabs you have open now and keeps the ones you want for later: see every window and tab group in one full view, save them as a session in one click, and bring them back with their tab group names and colors. Sync across desktop Chrome without creating an account or providing an email address.

[![Featured on the Chrome Web Store](https://img.shields.io/badge/Featured_on-Chrome_Web_Store-cce7e8?style=for-the-badge)](https://chromewebstore.google.com/detail/tab-keeper-chrome-tab-man/gpibgniomobngodpnikhheifblbpbbah?ref=github)
[![Current version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fjustine-george%2Ftab-keeper-react-chrome-extension%2Fmain%2Fpackage.json&query=version&style=for-the-badge&label=Version)](#changelog)
![Tab Keeper users](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fjustine-george%2Fjgeorge.com%2Fmain%2Fsrc%2Fdata%2Fextension-metrics.json&query=%24.tabKeeper.users&style=for-the-badge&label=Users)
[![MIT license](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](https://raw.githubusercontent.com/justine-george/tab-keeper-react-chrome-extension/main/LICENSE)

<a href="https://chromewebstore.google.com/detail/tab-keeper-chrome-tab-man/gpibgniomobngodpnikhheifblbpbbah?ref=github" target="_blank"><img src="store-assets/banners/chrome_web_store_download_button.png" width="300" alt="Get Tab Keeper from the Chrome Web Store"></a>

## Features

- **Currently Open:** See every window, tab group and tab you have open right now beside your saved sessions. Bring a window to the front, go to a tab group, or rename and recolor it.
- **Full View:** Open Tab Keeper in its own tab with panes you can widen, and go back to your tab in one click.
- **Save & Restore:** Save every open window as a session, or just the current one, and reopen it later. Sessions keep tab groups with their names and colors, pinned tabs, collapsed groups, and maximized and full-screen windows.
- **Drag Between Open and Saved:** Drop open tabs into a session to keep them, or drag saved tabs into Currently open to open them. Reorder tabs, groups, windows and sessions the same way.
- **Switch & Replace:** Jump to a saved session while Tab Keeper saves your current windows first, or replace a session with the windows you have open now.
- **Undo & Tidy Up:** Undo a delete, remove duplicate tabs, and sort tabs by site.
- **Save as PDF:** Preview any session, or the windows you have open, as a clean document, rename titles or hide rows, then save it as a PDF or print it. Or copy all its links at once.
- **Device Sync:** Turn on sync to access your sessions from Chrome desktop browsers connected to the same Chrome profile.
- **Privacy First:** No email address, account setup, or signup required. Sessions stay on your device until you choose to sync.
- **Backup to File:** Save your sessions to a file, and load them back by merging or replacing.
- **Quick Search:** Find any saved or open tab as you type, by its title or its tab group's name.
- **Keyboard Friendly:** Open Tab Keeper with a shortcut, and use it fully from the keyboard or with a screen reader.
- **Multi-Language Support:** Use Tab Keeper in 13 languages. It starts in Chrome's language.
- **Custom Themes:** Choose from seven light and dark themes, two of them with higher contrast.

## How It Works

1. Open Tab Keeper to see the windows and tabs you have open now, and save one window or all of them as a session.
2. Search, drag and organize your open tabs and saved sessions.
3. Restore a session later, or switch sessions while saving your current windows first.

## Video & Screenshots

https://github.com/user-attachments/assets/62f5a6cc-f2c2-4b4b-b722-ae473c3700fc

[Watch on YouTube →](https://www.youtube.com/watch?v=4_38WtIZxtM)

<a href="https://chromewebstore.google.com/detail/tab-keeper-chrome-tab-man/gpibgniomobngodpnikhheifblbpbbah?ref=github" target="_blank"><img src="store-assets/screenshots/tab-keeper-screenshot-1.png" width="800" alt="Tab Keeper's full view: saved sessions, the selected session and the windows open right now, side by side"></a>

[View All Screenshots →](https://github.com/justine-george/tab-keeper-react-chrome-extension/wiki/Screenshots)

## Privacy & Sync

Tab Keeper does not require an email address or a user-created account. It generates an anonymous identifier that Chrome syncs with your browser profile.

Your sessions are stored locally on your device. Tab Keeper asks before it syncs for the first time on each device. When device sync is enabled, saved session data—including tab URLs and titles—is sent to cloud storage so you can access it from other desktop Chrome browsers connected to the same profile. You can delete the cloud copy at any time from Settings → Sync & backup.

Read the full [privacy policy](PRIVACY.md).

## Changelog

### v.2.2.1 (Latest)

#### Improvements

- Every dialog title shares one style, and its icon lines up with the text
- Directions to a setting read the same way in every dialog and language, as in Settings › Sync & backup

### v.2.2.0

#### Features

- Open saved windows in the window you're in instead of a new one, with Open saved windows in Settings › Sessions, or by dropping a saved window onto an open one. The ⋮ menus offer whichever way the setting didn't pick
- Skip duplicate tabs, in Settings › Sessions: adding or moving tabs into a saved session leaves out pages it already has, and a new session keeps one copy of each
- Skip tabs already open, in Settings › Sessions: opening or dropping saved tabs into an open window leaves out pages it already has
- Clicking a saved tab that's already open switches to it. Middle-click or Ctrl-click (⌘-click on a Mac) opens a copy in the background. The row's name says Switch to tab or Open in new tab to match
- A saved group's Open goes to the group when it's already open, and says Go to group

#### Improvements

- A softer look: corners round by role across the app, and so do the logo, Chrome's toolbar icons, the theme tiles, the default-view drawings and the switches. Scrollbars stop short of rounded corners
- Add current window dims when only Tab Keeper is in the window, and a dimmed Back says why
- A session's row shows its new name while you type it in the header
- Clicking a saved session row slides it in when the saved session is folded away
- Links in the Save as PDF preview open nothing and say they open from the saved PDF. The Save as PDF… pointer stays until your second press
- The tour rings the search row and the selected session, and a press on its dim says everything else works after the tour
- Incognito windows are tagged Incognito in Currently open

#### Fixes

- A drop scrolled into the end of the list no longer jumps
- A group's tint stops at its last tab when a group above it is removed
- Dragging a group's only tab out lands where the rows below are drawn, instead of joining the group above
- Holding a saved window near Currently open's edge scrolls the list
- The Japanese session menu fits its pane

### v.2.1.0

#### Features

- Replace a saved window with the window you're in, from its menu. It keeps its name and place, and the rest of the session stays as it was
- Remove duplicate tabs from the windows you have open, from a window's menu or Currently open's right-click menu. Reopen brings them back
- After an update, What's new lists the main changes once, with a shortcut to any setting that changed
- The Save as PDF preview has a slim header with a way back to Tab Keeper, which asks first if your edits would be lost

#### Fixes

- In Save as PDF's Edit, rows follow the Comfortable layout instead of always drawing Compact's lines
- On a narrow window, Edit and Done in the Save as PDF preview no longer move the sheet
- Chrome's own Print… on the Save as PDF preview prints the file over as many pages as it needs, instead of one cut-off page with the toolbar
- A selected session's Open, Switch and Replace buttons no longer overlap in languages with longer words or at a larger font size
- A tab dragged out of Currently open and brought back over its left edge, by the resize grip, is moved back instead of copied
- On the tour, a save of your own after Use an example counts as the tour's, and the sample makes way for it
- A rating card already on screen steps aside for a tour or setup started over it, and comes back after
- The tour skips the pin step when this tab is already pinned and pinning in new windows is on

#### Improvements

- Copy links pastes one link per line. The old layout with headings is in Settings › Sessions
- The saved session and Currently open can be resized from a 1100px window, and the Currently open drawer is wider
- Short help lines under Auto sync, Backup, Cloud data and Save tab groups, and a clearer Delete cloud data dialog
- Until your first save, the save button's ring keeps pulsing, and the first save pops floppy disks
- Setup and the popup tour end on a last card: your session is saved, and Open brings it back

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
