// Keyboard-first command palette for page actions, bookmarks, tabs, themes, and tools.
const commandPaletteLauncher = document.getElementById('commandPaletteLauncher');
const commandPaletteBackdrop = document.getElementById('commandPaletteBackdrop');
const commandPalette = document.getElementById('commandPalette');
const commandPaletteClose = document.getElementById('commandPaletteClose');
const commandPaletteSearch = document.getElementById('commandPaletteSearch');
const commandPaletteSummary = document.getElementById('commandPaletteSummary');
const commandPaletteResults = document.getElementById('commandPaletteResults');

const COMMAND_PALETTE_LIMIT = 11;
let commandPaletteIsOpen = false;
let commandPaletteActiveIndex = 0;
let commandPaletteVisibleItems = [];
let commandPalettePreviousFocus = null;

function commandPaletteOpenPanel(shellId, focusSelector = '') {
  const shell = monitorShells.find((entry) => entry.dataset.shellId === shellId);
  if (!(shell instanceof HTMLElement)) {
    return;
  }

  setMonitorShellCollapsed(shell, false);
  shell.scrollIntoView({ block: 'start', behavior: 'smooth' });
  if (focusSelector) {
    setTimeout(() => shell.querySelector(focusSelector)?.focus(), 180);
  }
}

function commandPaletteSetUtilityMode(mode) {
  state.calcMode = mode;
  updateCalcUi();
  runCalculator();
  commandPaletteOpenPanel('devtools', '#calcInput');
}

function commandPaletteStaticItems() {
  const actions = [
    {
      id: 'action-search-bookmarks',
      kind: 'Action',
      title: 'Focus bookmark search',
      subtitle: 'Search bookmarks or run a web query',
      keywords: 'find library search web',
      run: () => commandPaletteOpenPanel('bookmarks', '#searchInput')
    },
    {
      id: 'action-create-stack',
      kind: 'Action',
      title: 'Create bookmark stack',
      subtitle: 'Open the stack builder',
      keywords: 'new group folder bookmarks',
      run: () => openStackModal()
    },
    {
      id: 'action-edit-stack',
      kind: 'Action',
      title: 'Edit bookmark stack',
      subtitle: openStackEditMenuBtn?.disabled ? 'No saved stacks available' : 'Choose a saved stack to edit',
      keywords: 'change group folder bookmarks',
      disabled: Boolean(openStackEditMenuBtn?.disabled),
      run: () => {
        commandPaletteOpenPanel('bookmarks');
        setTimeout(() => openStackEditMenuBtn?.click(), 180);
      }
    },
    {
      id: 'action-refresh-bookmarks',
      kind: 'Refresh',
      title: 'Refresh bookmarks',
      subtitle: 'Reload the browser bookmark library',
      keywords: 'sync reload library',
      run: () => loadBookmarks()
    },
    {
      id: 'action-refresh-tabs',
      kind: 'Refresh',
      title: 'Refresh open tabs',
      subtitle: 'Rescan tabs across browser windows',
      keywords: 'sync reload processes windows',
      run: () => loadTabs()
    },
    {
      id: 'action-refresh-status',
      kind: 'Refresh',
      title: 'Refresh Net Ops',
      subtitle: 'Check every configured status source now',
      keywords: 'network services status reload',
      run: () => refreshOperationsSidebar()
    },
    {
      id: 'action-add-status',
      kind: 'Action',
      title: 'Add Net Ops source',
      subtitle: 'Register another public status page',
      keywords: 'network service monitor new',
      run: () => openStatusModal()
    },
    {
      id: 'action-tour',
      kind: 'Help',
      title: 'Start guided tour',
      subtitle: 'Replay the VaporTab walkthrough',
      keywords: 'help tutorial walkthrough',
      run: () => startPageTour()
    }
  ];

  const panels = [
    ['bookmarks', 'Open Bookmarks panel', 'Library and bookmark stacks'],
    ['tabs', 'Open Tabs panel', 'Active tabs across browser windows'],
    ['devtools', 'Open Utilities panel', 'Encoding, hashes, and timestamps']
  ].map(([shellId, title, subtitle]) => ({
    id: `panel-${shellId}`,
    kind: 'Panel',
    title,
    subtitle,
    keywords: `jump show ${shellId}`,
    run: () => commandPaletteOpenPanel(shellId)
  }));

  const themes = [
    ['lcars', 'LCARS'],
    ['synthwave', 'Synthwave'],
    ['dark', 'Dark Mode'],
    ['terminal', 'Terminal UI'],
    ['old-pc', 'Old PC Dark']
  ].map(([themeId, label]) => ({
    id: `theme-${themeId}`,
    kind: 'Theme',
    title: `Switch to ${label}`,
    subtitle: state.theme === themeId ? 'Current theme' : 'Apply and remember this theme',
    keywords: `appearance style color ${label}`,
    run: () => applyTheme(themeId)
  }));

  const tools = [
    ['base64', 'Open Base64 tool', 'Encode or decode UTF-8 text'],
    ['url', 'Open URL tool', 'Encode or decode URL components'],
    ['sha256', 'Open SHA-256 tool', 'Generate a SHA-256 hex digest'],
    ['unix', 'Open Unix time tool', 'Convert timestamps and date strings']
  ].map(([mode, title, subtitle]) => ({
    id: `tool-${mode}`,
    kind: 'Tool',
    title,
    subtitle,
    keywords: `utility converter developer ${mode}`,
    run: () => commandPaletteSetUtilityMode(mode)
  }));

  return [...actions, ...panels, ...themes, ...tools];
}

function commandPaletteDynamicItems() {
  const bookmarks = state.allBookmarks
    .filter((bookmark) => bookmark?.url)
    .map((bookmark, index) => ({
      id: `bookmark-${getBookmarkMetricKey(bookmark) || index}`,
      kind: bookmark.type === 'stack' ? 'Stack' : 'Bookmark',
      title: bookmark.name || shortHost(bookmark.url),
      subtitle: `${bookmark.trail || bookmark.folder || 'root'} / ${shortHost(bookmark.url)}`,
      keywords: `${bookmark.url} ${bookmark.folder || ''} ${bookmark.trail || ''}`,
      run: async () => {
        const metricKey = getBookmarkMetricKey(bookmark);
        if (metricKey) {
          state.clicks[metricKey] = getBookmarkClicks(metricKey) + 1;
          saveClicks();
          renderBookmarks();
        }
        if (bookmark.type === 'stack') {
          await launchStackBookmark(bookmark);
        } else {
          await openBookmarkTarget(bookmark.url);
        }
      }
    }));

  const tabs = state.tabs.map((tab, index) => ({
    id: `tab-${tab.windowId}-${tab.id || index}`,
    kind: 'Tab',
    title: tab.title || 'Untitled tab',
    subtitle: `${tab.active ? 'Active / ' : ''}${tab.host || shortHost(tab.url)}`,
    keywords: `${tab.url || ''} ${tab.host || ''} window ${tab.windowId}`,
    run: () => focusBrowserTab(tab.id, tab.windowId)
  }));

  return [...bookmarks, ...tabs];
}

function commandPaletteScore(item, query) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return item.kind === 'Action' || item.kind === 'Refresh' ? 20 : 10;
  }

  const title = item.title.toLowerCase();
  const subtitle = item.subtitle.toLowerCase();
  const keywords = String(item.keywords || '').toLowerCase();
  const haystack = `${title} ${subtitle} ${keywords} ${item.kind.toLowerCase()}`;
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (!tokens.every((token) => haystack.includes(token))) {
    return -1;
  }

  let score = 0;
  if (title === normalizedQuery) score += 160;
  if (title.startsWith(normalizedQuery)) score += 100;
  if (title.includes(normalizedQuery)) score += 60;
  if (subtitle.includes(normalizedQuery)) score += 25;
  for (const token of tokens) {
    if (title.split(/\s+/).some((word) => word.startsWith(token))) score += 18;
    if (keywords.includes(token)) score += 6;
  }
  return score;
}

function commandPaletteGetItems(query) {
  const staticItems = commandPaletteStaticItems();
  const candidates = query.trim() ? [...staticItems, ...commandPaletteDynamicItems()] : staticItems;
  return candidates
    .map((item) => ({ item, score: commandPaletteScore(item, query) }))
    .filter((entry) => entry.score >= 0 && !entry.item.disabled)
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
    .slice(0, COMMAND_PALETTE_LIMIT)
    .map((entry) => entry.item);
}

function commandPaletteSetActiveIndex(index) {
  if (!commandPaletteVisibleItems.length) {
    commandPaletteActiveIndex = 0;
    commandPaletteSearch.removeAttribute('aria-activedescendant');
    return;
  }

  commandPaletteActiveIndex = (index + commandPaletteVisibleItems.length) % commandPaletteVisibleItems.length;
  const buttons = Array.from(commandPaletteResults.querySelectorAll('.command-palette-item'));
  buttons.forEach((button, buttonIndex) => {
    const active = buttonIndex === commandPaletteActiveIndex;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
    if (active) {
      commandPaletteSearch.setAttribute('aria-activedescendant', button.id);
      button.scrollIntoView({ block: 'nearest' });
    }
  });
}

function commandPaletteRender() {
  const query = commandPaletteSearch.value || '';
  commandPaletteVisibleItems = commandPaletteGetItems(query);
  commandPaletteResults.innerHTML = '';

  if (!commandPaletteVisibleItems.length) {
    const empty = document.createElement('p');
    empty.className = 'command-palette-empty';
    empty.textContent = 'No matching commands, bookmarks, or tabs.';
    commandPaletteResults.appendChild(empty);
    commandPaletteSummary.textContent = '0 results';
    commandPaletteSetActiveIndex(0);
    return;
  }

  commandPaletteVisibleItems.forEach((item, index) => {
    const button = document.createElement('button');
    button.id = `commandPaletteResult${index}`;
    button.className = 'command-palette-item';
    button.type = 'button';
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', 'false');
    button.disabled = Boolean(item.disabled);

    const badge = document.createElement('span');
    badge.className = 'command-palette-kind';
    badge.textContent = item.kind;

    const copy = document.createElement('span');
    copy.className = 'command-palette-copy';
    const title = document.createElement('strong');
    title.textContent = item.title;
    const subtitle = document.createElement('span');
    subtitle.textContent = item.subtitle;
    copy.appendChild(title);
    copy.appendChild(subtitle);

    const arrow = document.createElement('span');
    arrow.className = 'command-palette-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = 'ENTER';

    button.appendChild(badge);
    button.appendChild(copy);
    button.appendChild(arrow);
    button.addEventListener('mouseenter', () => commandPaletteSetActiveIndex(index));
    button.addEventListener('click', () => commandPaletteRunItem(index));
    commandPaletteResults.appendChild(button);
  });

  commandPaletteSummary.textContent = query.trim()
    ? `${commandPaletteVisibleItems.length} best result${commandPaletteVisibleItems.length === 1 ? '' : 's'}`
    : 'Popular commands';
  commandPaletteSetActiveIndex(Math.min(commandPaletteActiveIndex, commandPaletteVisibleItems.length - 1));
}

function closeCommandPalette({ restoreFocus = true } = {}) {
  if (!commandPaletteIsOpen) {
    return;
  }
  commandPaletteIsOpen = false;
  commandPaletteBackdrop.hidden = true;
  document.body.classList.remove('command-palette-open');
  commandPaletteSearch.removeAttribute('aria-activedescendant');
  if (restoreFocus && commandPalettePreviousFocus instanceof HTMLElement) {
    commandPalettePreviousFocus.focus();
  }
}

function openCommandPalette() {
  if (document.body.classList.contains('tour-active')) {
    return;
  }
  commandPalettePreviousFocus = document.activeElement;
  commandPaletteIsOpen = true;
  commandPaletteActiveIndex = 0;
  commandPaletteSearch.value = '';
  commandPaletteBackdrop.hidden = false;
  document.body.classList.add('command-palette-open');
  commandPaletteRender();
  commandPaletteSearch.focus();
}

function commandPaletteRunItem(index = commandPaletteActiveIndex) {
  const item = commandPaletteVisibleItems[index];
  if (!item || item.disabled) {
    return;
  }
  closeCommandPalette({ restoreFocus: false });
  setTimeout(() => {
    Promise.resolve(item.run()).catch((error) => {
      console.error(`Unable to run command palette item: ${item.title}`, error);
    });
  }, 0);
}

function handleCommandPaletteKeydown(event) {
  const modifierPressed = event.ctrlKey || event.metaKey;
  if (modifierPressed && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (commandPaletteIsOpen) {
      commandPaletteSearch.focus();
    } else {
      openCommandPalette();
    }
    return;
  }

  if (!commandPaletteIsOpen) {
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    closeCommandPalette();
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    commandPaletteSetActiveIndex(commandPaletteActiveIndex + 1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    commandPaletteSetActiveIndex(commandPaletteActiveIndex - 1);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    commandPaletteRunItem();
  } else if (event.key === 'Tab') {
    const focusTargets = [commandPaletteSearch, commandPaletteClose];
    const currentIndex = focusTargets.indexOf(document.activeElement);
    const nextIndex = event.shiftKey
      ? (currentIndex <= 0 ? focusTargets.length - 1 : currentIndex - 1)
      : (currentIndex >= focusTargets.length - 1 ? 0 : currentIndex + 1);
    event.preventDefault();
    focusTargets[nextIndex].focus();
  }
}

commandPaletteLauncher?.addEventListener('click', openCommandPalette);
commandPaletteClose?.addEventListener('click', () => closeCommandPalette());
commandPaletteSearch?.addEventListener('input', () => {
  commandPaletteActiveIndex = 0;
  commandPaletteRender();
});
commandPaletteBackdrop?.addEventListener('click', (event) => {
  if (event.target === commandPaletteBackdrop) {
    closeCommandPalette();
  }
});
document.addEventListener('keydown', handleCommandPaletteKeydown);
