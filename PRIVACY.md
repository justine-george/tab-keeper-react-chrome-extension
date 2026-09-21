# Privacy Policy

**Tab Keeper — Chrome extension**

Last updated: 21 September 2026

Tab Keeper saves your open windows and tabs as sessions so you can reopen them later. This policy explains what information Tab Keeper handles, how it is used, where it is stored, and how you can remove it.

## Information Tab Keeper handles

### Saved sessions

When you save a session, Tab Keeper records:

- The URL, title, and icon address of each saved tab
- How tabs are arranged into windows and tab groups
- Session, window, and tab-group names
- Tab-group colors and window arrangement
- Timestamps, ordering information, internal identifiers, and deletion records needed to keep sessions consistent across devices

Tab Keeper reads this information from Chrome. It does not inspect page bodies, forms, messages, or other webpage contents.

### Settings

Tab Keeper stores settings including your theme, language, sync preference, display choices, and whether you have dismissed optional prompts.

### Anonymous sync identifier

On first run, Tab Keeper creates a random identifier and stores it in Chrome sync storage. Chrome may copy this identifier to other devices using the same Chrome profile. Tab Keeper uses it to locate the Firestore document shared by those devices.

Tab Keeper does not receive or store your name, email address, or Google account identity.

## How Tab Keeper uses information

Tab Keeper uses saved-session information only to:

- Display and organize your saved sessions
- Reopen saved tabs, windows, and tab groups
- Export sessions to a backup file
- Synchronize sessions across devices when cloud sync is enabled

Settings are used to apply your preferences. The anonymous identifier is used only to connect synced sessions across your devices.

## How information is stored and shared

### On your device

Sessions and settings are stored locally in the extension's storage within your Chrome profile.

The anonymous sync identifier is stored separately in Chrome sync storage. Chrome's handling of that identifier is governed by the [Google Privacy Policy](https://policies.google.com/privacy).

### Google Firebase

Tab Keeper asks for your permission before syncing for the first time on each device. It does not contact Firebase or upload sessions until you enable cloud sync or request a manual sync. If cloud data already exists, using **Delete cloud data** also contacts Firebase so that data can be removed.

When cloud sync is enabled or you manually request a sync, Tab Keeper signs in to Firebase anonymously. Firebase creates an anonymous authentication record; no registration or email address is required.

Tab Keeper then stores your sessions in a single Google Cloud Firestore document identified by the anonymous sync identifier. Google provides the authentication and cloud-storage services under the [Google Privacy Policy](https://policies.google.com/privacy) and [Firebase privacy and security terms](https://firebase.google.com/support/privacy).

### Backup files

If you choose **Save sessions to a file**, Tab Keeper writes your sessions and their associated metadata to a file on your computer. You choose where that file is stored. Backup files do not include your Tab Keeper settings.

### Tab icons

Tab Keeper may request an icon from the server hosting a saved tab's icon. That server may receive information normally associated with a web request, such as your IP address. When no saved icon address is available, Tab Keeper asks Chrome for an icon from Chrome's favicon cache.

## Data sharing and advertising

Tab Keeper does not sell user data.

It shares information with Google only as necessary to provide Chrome sync storage, anonymous Firebase authentication, and optional Firestore session synchronization. Tab Keeper does not use analytics, advertising, or behavioral tracking.

Tab Keeper does not transmit your saved-session data to any other service. Requests for tab icons are limited to retrieving those icons as described above.

## Data retention and deletion

### Data on this device

Saved sessions remain until you delete them, clear the extension's storage, or uninstall Tab Keeper. Deleting a session removes its saved contents. A deletion record containing only the session's internal identifier and deletion time is kept so the deletion can be synchronized to other devices. It becomes eligible for cleanup after 30 days and may remain until a later sync performs that cleanup.

Settings remain until the extension's storage is cleared or Tab Keeper is uninstalled.

The anonymous identifier remains in Chrome sync storage until the extension's synced storage is removed. Google's retention practices apply to information handled by Chrome sync.

### Cloud session data

Your Firestore session document remains until you delete it. Turning off Auto Sync or uninstalling Tab Keeper does not delete an existing cloud document.

To remove it, open:

**Settings → Sync & Backup → Delete cloud data**

This deletes the Firestore session document and turns off Auto Sync on that device. It does not delete sessions stored locally on your devices.

Another device using the same Chrome profile may upload its local copy again the next time it syncs. To prevent that, turn off Auto Sync on your other devices before deleting the cloud document.

Deleting the Firestore document does not necessarily remove Firebase authentication records or operational logs retained by Google under its own policies. Those records do not contain your saved sessions, name, or email address.

If you cannot use the deletion control, contact the developer at the address below.

## Permissions

- **`tabs`:** Reads the URLs, titles, and icons of tabs you choose to save and reopens saved tabs.
- **`storage`:** Stores the anonymous sync identifier in Chrome sync storage.
- **`favicon`:** Retrieves tab icons from Chrome's favicon cache.
- **`tabGroups` (optional):** Saves and restores Chrome tab groups. Tab Keeper requests this permission only after you choose to enable the feature.

## Security

Information sent to Google Firebase is transmitted using encrypted connections.

Local extension storage and exported backup files are not separately encrypted by Tab Keeper. Anyone with access to your Chrome profile or an exported backup file may be able to read the sessions stored there.

## Your choices

You can:

- Export a copy of your sessions with **Save sessions to a file**
- Delete individual sessions from Tab Keeper
- Turn off Auto Sync to stop automatic cloud updates from that device
- Delete your Firestore session document through **Delete cloud data**
- Uninstall Tab Keeper to remove its local extension data
- Contact the developer with a privacy question or request

## Use of Chrome API data

Tab Keeper's use of information received from Chrome APIs complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements.

## Changes to this policy

This policy is maintained in Tab Keeper's public source repository, where its revision history is visible. When the policy changes, the date at the top of this page will be updated. Material changes to how Tab Keeper handles information will also be disclosed through the extension or its Chrome Web Store listing.

## Contact

Justine George

justinegeo96@gmail.com
