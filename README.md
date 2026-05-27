# VaporTab-3000

A custom Chromium new-tab page with a retro terminal look, live bookmarks, cross-window tab tools, status monitoring, and a small developer utility panel.

## What It Does

- Replaces the browser new-tab page through `chrome_url_overrides`
- Shows live browser bookmarks with folder filters and click heat/ranking
- Supports stacked bookmarks for launch groups
- Shows open tabs across browser windows and lets you jump to or close them
- Includes a GitHub incident/watch card plus a configurable status-source sidebar
- Includes a small utility panel for Base64, URL encode/decode, SHA-256, and Unix timestamp conversion
- Supports theme switching between `Synthwave` and `Dark Mode`

## Requirements

- A Chromium browser that supports Manifest V3 extensions
- Permissions used by this extension:
  - `bookmarks`
  - `tabs`
  - `favicon`
  - host access to `"<all_urls>"`

## Install / Load

There is no build step.

1. Open the browser extensions page.
2. Enable developer mode.
3. Choose `Load unpacked`.
4. Select this folder: `F:\GitHub\New-Tab-Page`
5. Open a new tab.

The extension uses [manifest.json](/f:/GitHub/New-Tab-Page/manifest.json:1) and overrides the new-tab page with [new-tab.html](/f:/GitHub/New-Tab-Page/new-tab.html:1).

## Stacked Bookmarks

Stacked bookmarks are represented by bookmark folders whose name starts with `[stack]`.

Example:

- `[stack] Morning Run`
- `[stack] Meme Time`

How it works:

- Create a normal bookmark folder in your browser.
- Prefix the folder name with `[stack]`.
- Put the bookmarks you want to launch inside that folder in order.
- The folder appears as a single card on the new-tab page.

Launch behavior:

- Earlier items in the stack open as supporting tabs.
- The final item behaves like the primary destination.
- Existing-tab matching can still kick in for stack items, depending on what is already open.

## Existing Tab Matching

When a bookmark matches an already-open tab, the page can prompt you with a chooser modal.

Current behavior:

- For a normal bookmark, choosing an existing tab moves that tab into the current window beside the current new-tab page, then closes the current new-tab page.
- For stack launches, reused tabs are also moved into the current window so the stack stays local instead of scattering across windows.

## Project Layout

- [new-tab.html](/f:/GitHub/New-Tab-Page/new-tab.html:1): main markup
- [styles.css](/f:/GitHub/New-Tab-Page/styles.css:1): all styling and responsive layout
- [js/app-core.js](/f:/GitHub/New-Tab-Page/js/app-core.js:1): shared state, DOM references, helpers, calculator, permissions, and browser API access
- [js/app-status.js](/f:/GitHub/New-Tab-Page/js/app-status.js:1): status feed logic, GitHub watch card, and bookmark match modal logic
- [js/app-tabs.js](/f:/GitHub/New-Tab-Page/js/app-tabs.js:1): tab rendering, focusing, closing, and move helpers
- [js/app-bookmarks.js](/f:/GitHub/New-Tab-Page/js/app-bookmarks.js:1): bookmark loading, filtering, stacked bookmark launch logic, and address handling
- [js/app-init.js](/f:/GitHub/New-Tab-Page/js/app-init.js:1): event listeners and bootstrapping
- [app.js](/f:/GitHub/New-Tab-Page/app.js:1): legacy placeholder noting the split into `js/`
- [vivaldi_new_tab_starter.html](/f:/GitHub/New-Tab-Page/vivaldi_new_tab_starter.html:1): legacy copy kept only because the original file was locked during renaming

## Development Notes

- The app is plain HTML/CSS/JavaScript with no bundler.
- Script loading order matters because the files share global state/functions.
- If bookmark or tab behavior changes, reload the unpacked extension before testing again.

## Troubleshooting

### Bookmarks show fallback data

That usually means the page could not read browser bookmarks in the current context. Check that the extension is loaded correctly and still has `bookmarks` permission.

### Stack launches are behaving strangely

Open DevTools on the new-tab page and look for `stack-debug` console lines. The app logs stack launch state, reuse checks, tab creation, and tab move requests to help debug placement issues.

### Status sources are blank

The sidebar status cards rely on public status endpoints. Temporary fetch failures should show up in the UI as error states.

## Version

Current manifest version: `0.1.0`
