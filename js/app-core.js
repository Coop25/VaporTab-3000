// Shared state, DOM references, helpers, calculator, and browser API access
const STORAGE_KEYS = {
  tag: 'new-tab-active-tag',
  expanded: 'new-tab-expanded',
  tabsExpanded: 'new-tab-tabs-expanded',
  statusSources: 'new-tab-status-sources',
  watchSource: 'new-tab-watch-source',
  theme: 'new-tab-theme',
  clicks: 'new-tab-clicks',
  bookmarkOrder: 'new-tab-bookmark-order',
  bookmarkOrderLocked: 'new-tab-bookmark-order-locked',
  tabActivity: 'new-tab-tab-activity',
  collapsedShells: 'new-tab-collapsed-shells',
  tourCompleted: 'new-tab-tour-completed'
};

const STORAGE_MIGRATION_KEY = 'new-tab-extension-storage-migration-v1';
const persistentStorageCache = new Map();
let persistentStorageInitialized = false;
let persistentStorageArea = null;

function getExtensionStorageArea() {
  if (typeof browser !== 'undefined' && browser.storage?.local) {
    return browser.storage.local;
  }
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    return chrome.storage.local;
  }
  return null;
}

function extensionStorageGet(area, keys) {
  if (typeof browser !== 'undefined' && area === browser.storage?.local) {
    return browser.storage.local.get(keys);
  }

  return new Promise((resolve, reject) => {
    area.get(keys, (values) => {
      const error = typeof chrome !== 'undefined' ? chrome.runtime?.lastError : null;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(values || {});
    });
  });
}

function extensionStorageSet(area, values) {
  if (typeof browser !== 'undefined' && area === browser.storage?.local) {
    return browser.storage.local.set(values);
  }

  return new Promise((resolve, reject) => {
    area.set(values, () => {
      const error = typeof chrome !== 'undefined' ? chrome.runtime?.lastError : null;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

function extensionStorageRemove(area, key) {
  if (typeof browser !== 'undefined' && area === browser.storage?.local) {
    return browser.storage.local.remove(key);
  }

  return new Promise((resolve, reject) => {
    area.remove(key, () => {
      const error = typeof chrome !== 'undefined' ? chrome.runtime?.lastError : null;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

function readPersistentStorage(key) {
  if (persistentStorageCache.has(key)) {
    return persistentStorageCache.get(key);
  }
  return persistentStorageInitialized ? null : localStorage.getItem(key);
}

function writePersistentStorage(key, value) {
  const normalizedValue = String(value);
  persistentStorageCache.set(key, normalizedValue);

  if (!persistentStorageArea) {
    localStorage.setItem(key, normalizedValue);
    return;
  }

  extensionStorageSet(persistentStorageArea, { [key]: normalizedValue }).catch((error) => {
    console.error(`Unable to save ${key} to extension storage`, error);
  });
}

function removePersistentStorage(key) {
  persistentStorageCache.delete(key);

  if (!persistentStorageArea) {
    localStorage.removeItem(key);
    return;
  }

  extensionStorageRemove(persistentStorageArea, key).catch((error) => {
    console.error(`Unable to remove ${key} from extension storage`, error);
  });
}

async function initializePersistentStorage() {
  persistentStorageArea = getExtensionStorageArea();
  if (!persistentStorageArea) {
    return;
  }

  const applicationKeys = Object.values(STORAGE_KEYS);

  try {
    const storedValues = await extensionStorageGet(
      persistentStorageArea,
      [...applicationKeys, STORAGE_MIGRATION_KEY]
    );

    if (storedValues[STORAGE_MIGRATION_KEY] !== 1) {
      const migrationValues = { [STORAGE_MIGRATION_KEY]: 1 };
      for (const key of applicationKeys) {
        if (storedValues[key] !== undefined) {
          continue;
        }
        const legacyValue = localStorage.getItem(key);
        if (legacyValue !== null) {
          migrationValues[key] = legacyValue;
        }
      }
      await extensionStorageSet(persistentStorageArea, migrationValues);
      Object.assign(storedValues, migrationValues);
    }

    for (const key of applicationKeys) {
      if (storedValues[key] !== undefined) {
        persistentStorageCache.set(key, storedValues[key]);
      }
    }
    persistentStorageInitialized = true;
  } catch (error) {
    console.error('Unable to initialize extension storage; using legacy localStorage', error);
    persistentStorageArea = null;
  }
}

const FALLBACK_BOOKMARKS = [
  { name: 'GitHub', url: 'https://github.com', folder: 'Quick' },
  { name: 'MDN Web Docs', url: 'https://developer.mozilla.org', folder: 'Dev' },
  { name: 'Stack Overflow', url: 'https://stackoverflow.com', folder: 'Dev' },
  { name: 'YouTube', url: 'https://www.youtube.com', folder: 'Media' },
  { name: 'Gmail', url: 'https://mail.google.com', folder: 'Quick' },
  { name: 'Calendar', url: 'https://calendar.google.com', folder: 'Quick' }
];

const state = {
  activeTag: readPersistentStorage(STORAGE_KEYS.tag) || 'all',
  expanded: readPersistentStorage(STORAGE_KEYS.expanded) === '1',
  tabsExpanded: readPersistentStorage(STORAGE_KEYS.tabsExpanded) === '1',
  allBookmarks: [],
  sourceLabel: 'Fallback bookmarks',
  statusSources: [],
  statusById: new Map(),
  theme: readPersistentStorage(STORAGE_KEYS.theme) || 'lcars',
  clicks: loadClicks(),
  bookmarkOrder: loadBookmarkOrder(),
  bookmarkOrderLocked: readPersistentStorage(STORAGE_KEYS.bookmarkOrderLocked) !== '0',
  tabActivity: loadTabActivity(),
  bookmarkReloadTimer: null,
  githubIncident: null,
  watchSourceId: readPersistentStorage(STORAGE_KEYS.watchSource) || ''
};

function hydrateStateFromPersistentStorage() {
  state.activeTag = readPersistentStorage(STORAGE_KEYS.tag) || 'all';
  state.expanded = readPersistentStorage(STORAGE_KEYS.expanded) === '1';
  state.tabsExpanded = readPersistentStorage(STORAGE_KEYS.tabsExpanded) === '1';
  state.theme = readPersistentStorage(STORAGE_KEYS.theme) || 'lcars';
  state.clicks = loadClicks();
  state.bookmarkOrder = loadBookmarkOrder();
  state.bookmarkOrderLocked = readPersistentStorage(STORAGE_KEYS.bookmarkOrderLocked) !== '0';
  state.tabActivity = loadTabActivity();
  state.watchSourceId = readPersistentStorage(STORAGE_KEYS.watchSource) || '';
}

const VISIBLE_COLLAPSED = 16;
const VISIBLE_TABS_COLLAPSED = 8;
const STATUS_REFRESH_MS = 300000;
const GITHUB_STATUS_URL = 'https://www.githubstatus.com';
const GITHUB_STATUS_HISTORY_URL = 'https://www.githubstatus.com/history';
const DEFAULT_STATUS_SOURCES = [
  { name: 'GitHub', url: GITHUB_STATUS_URL },
  { name: 'Discord', url: 'https://discordstatus.com' },
  { name: 'EVE Online', url: 'https://status.eveonline.com' }
];

const searchInput = document.getElementById('searchInput');
const refreshBtn = document.getElementById('refreshBtn');
const bookmarkGrid = document.getElementById('bookmarkGrid');
const bookmarkCount = document.getElementById('bookmarkCount');
const tagBar = document.getElementById('tagBar');
const toggleBtn = document.getElementById('toggleBtn');
const bookmarkOrderLock = document.getElementById('bookmarkOrderLock');
const bookmarkOrderHint = document.getElementById('bookmarkOrderHint');
const openStackModalBtn = document.getElementById('openStackModalBtn');
const stackEditControl = document.getElementById('stackEditControl');
const openStackEditMenuBtn = document.getElementById('openStackEditMenuBtn');
const stackEditMenu = document.getElementById('stackEditMenu');
const stackModal = document.getElementById('stackModal');
const closeStackModalBtn = document.getElementById('closeStackModalBtn');
const stackModalTitle = document.getElementById('stackModalTitle');
const stackNameInput = document.getElementById('stackNameInput');
const stackBookmarkSearch = document.getElementById('stackBookmarkSearch');
const availableBookmarkList = document.getElementById('availableBookmarkList');
const selectedBookmarkList = document.getElementById('selectedBookmarkList');
const availableBookmarkCount = document.getElementById('availableBookmarkCount');
const selectedBookmarkCount = document.getElementById('selectedBookmarkCount');
const stackModalMessage = document.getElementById('stackModalMessage');
const cancelStackBtn = document.getElementById('cancelStackBtn');
const createStackBtn = document.getElementById('createStackBtn');
const sourceText = document.getElementById('sourceText');
const helperText = document.getElementById('helperText');
const clockTime = document.getElementById('clockTime');
const clockDate = document.getElementById('clockDate');
const footerNote = document.getElementById('footerNote');
const tabsList = document.getElementById('tabsList');
const tabsSummary = document.getElementById('tabsSummary');
const refreshTabsBtn = document.getElementById('refreshTabsBtn');
const tabsToggleBtn = document.getElementById('tabsToggleBtn');
const tabsHelperText = document.getElementById('tabsHelperText');
const tabsCount = document.getElementById('tabsCount');
const statusList = document.getElementById('statusList');
const statusNameInput = document.getElementById('statusNameInput');
const statusUrlInput = document.getElementById('statusUrlInput');
const addStatusBtn = document.getElementById('addStatusBtn');
const refreshStatusBtn = document.getElementById('refreshStatusBtn');
const openStatusModalBtn = document.getElementById('openStatusModalBtn');
const editStatusBtn = document.getElementById('editStatusBtn');
const statusEditHint = document.getElementById('statusEditHint');
const statusModal = document.getElementById('statusModal');
const statusModalTitle = document.getElementById('statusModalTitle');
const closeStatusModalBtn = document.getElementById('closeStatusModalBtn');
const cancelStatusModalBtn = document.getElementById('cancelStatusModalBtn');
const bookmarkMatchModal = document.getElementById('bookmarkMatchModal');
const bookmarkMatchCopy = document.getElementById('bookmarkMatchCopy');
const bookmarkMatchList = document.getElementById('bookmarkMatchList');
const bookmarkMatchNewBtn = document.getElementById('bookmarkMatchNewBtn');
const bookmarkMatchCancelBtn = document.getElementById('bookmarkMatchCancelBtn');
const closeBookmarkMatchModalBtn = document.getElementById('closeBookmarkMatchModalBtn');
const statusPulse = document.getElementById('statusPulse');
const statusPulseText = document.getElementById('statusPulseText');
const statusRefreshMeta = document.getElementById('statusRefreshMeta');
const statusConsole = document.querySelector('.status-console');
const themeSwitcher = document.getElementById('themeSwitcher');
const githubIncidentTitle = document.getElementById('githubIncidentTitle');
const githubIncidentDays = document.getElementById('githubIncidentDays');
const githubIncidentBadge = document.getElementById('githubIncidentBadge');
const githubIncidentRange = document.getElementById('githubIncidentRange');
const githubIncidentSummary = document.getElementById('githubIncidentSummary');
const githubIncidentHighScore = document.getElementById('githubIncidentHighScore');
const githubIncidentMeta = document.getElementById('githubIncidentMeta');
const githubIncidentLink = document.getElementById('githubIncidentLink');
const calcModeBar = document.getElementById('calcModeBar');
const calcDirectionBtn = document.getElementById('calcDirectionBtn');
const calcRunBtn = document.getElementById('calcRunBtn');
const calcSwapBtn = document.getElementById('calcSwapBtn');
const calcCopyBtn = document.getElementById('calcCopyBtn');
const calcInput = document.getElementById('calcInput');
const calcOutput = document.getElementById('calcOutput');
const calcHint = document.getElementById('calcHint');
const calcQuickBar = document.getElementById('calcQuickBar');
const calcLatency = document.getElementById('calcLatency');
const calcChars = document.getElementById('calcChars');
const calcLines = document.getElementById('calcLines');
const calcBytes = document.getElementById('calcBytes');
const monitorShells = Array.from(document.querySelectorAll('.monitor-shell[data-shell-id]'));

state.statusIsRefreshing = false;
state.statusNextRefreshAt = Date.now() + STATUS_REFRESH_MS;
state.statusEditMode = false;
state.editingStatusId = '';
state.draggedStatusId = '';
state.githubIncidentIsRefreshing = false;
state.githubIncidentRefreshToken = 0;
state.calcMode = 'base64';
state.calcDirection = 'encode';
state.calcToken = 0;
state.bookmarkListenersAttached = false;
state.tabs = [];
state.tabsReloadTimer = null;
state.tabListenersAttached = false;
state.collapsedShells = loadCollapsedShells();
state.bookmarkMatchResolver = null;
state.bookmarkMatchPending = null;
state.stackDraft = new Set();
state.stackIsSaving = false;
state.editingStack = null;
state.stackEditSourceItems = [];
state.draggedStackKey = '';
state.draggedBookmarkKey = '';
state.suppressBookmarkClickUntil = 0;

const THEME_COPY = {
  lcars: {
    mastheadEyebrow: 'LCARS // PERSONAL OPERATIONS',
    mastheadTitle: 'FEDERATION ACCESS TERMINAL',
    systemId: 'SYS 47-A',
    nodeLabel: 'LCARS NODE',
    nodeModel: 'OPS 47-A',
    bookmarksChannel: 'LCARS 01-BOOKMARKS',
    tabsChannel: 'LCARS 02-TABS',
    toolsChannel: 'LCARS 03-TOOLS',
    stackKicker: 'LCARS // BOOKMARK ASSEMBLY',
    footerNotice: 'LCARS NOTICE // Live bookmark access requires extension new-tab context with bookmarks permission.'
  },
  synthwave: {
    mastheadEyebrow: 'VAPORTAB // NIGHT DRIVE',
    mastheadTitle: 'VaporTab-3000',
    systemId: 'VAPOR OS',
    nodeLabel: 'VAPORTAB NODE',
    nodeModel: 'VT-3000',
    bookmarksChannel: 'BOOKMARK WAVE',
    tabsChannel: 'TAB MATRIX',
    toolsChannel: 'DEV TOOLS',
    stackKicker: 'VAPORTAB // BOOKMARK ASSEMBLY',
    footerNotice: 'VAPORTAB NOTICE // Live bookmark access requires extension new-tab context with bookmarks permission.'
  },
  dark: {
    mastheadEyebrow: 'PERSONAL DASHBOARD',
    mastheadTitle: 'VaporTab-3000',
    systemId: 'LOCAL',
    nodeLabel: 'LOCAL NODE',
    nodeModel: 'VT-3000',
    bookmarksChannel: 'BOOKMARKS',
    tabsChannel: 'TABS',
    toolsChannel: 'TOOLS',
    stackKicker: 'BOOKMARK ASSEMBLY',
    footerNotice: 'Live bookmark access requires extension new-tab context with bookmarks permission.'
  },
  terminal: {
    mastheadEyebrow: 'ROOT / SYSTEM / DASHBOARD_OVERVIEW',
    mastheadTitle: 'SYSTEM DASHBOARD',
    systemId: 'SYS: OK',
    nodeLabel: 'TERMINAL_UI',
    nodeModel: 'LOCAL // STABLE',
    bookmarksChannel: 'RESOURCE_LIBRARY',
    tabsChannel: 'ACTIVE_PROCESSES',
    toolsChannel: 'SYSTEM_UTILITIES',
    stackKicker: 'TERMINAL_UI // BOOKMARK_ASSEMBLY',
    footerNotice: 'SYSTEM NOTICE // Browser bookmark permission is required for live resource access.'
  },
  'old-pc': {
    mastheadEyebrow: 'C:\\VAPORTAB\\DESKTOP',
    mastheadTitle: 'VaporTab Program Manager',
    systemId: 'LOCAL PC',
    nodeLabel: 'MY COMPUTER',
    nodeModel: 'VAPORTAB 95',
    bookmarksChannel: 'BOOKMARKS.EXE',
    tabsChannel: 'TASK MANAGER',
    toolsChannel: 'ACCESSORIES',
    stackKicker: 'PROGRAM MANAGER // BOOKMARK GROUP',
    footerNotice: 'SYSTEM MESSAGE // Live bookmarks require browser permission.'
  }
};

function applyThemeCopy(themeName) {
  const copy = THEME_COPY[themeName] || THEME_COPY.dark;
  document.title = 'VaporTab-3000';
  for (const element of document.querySelectorAll('[data-theme-copy]')) {
    const key = element.dataset.themeCopy || '';
    if (copy[key]) {
      element.textContent = copy[key];
    }
  }
}

function applyTheme(themeName) {
  const allowed = new Set(['lcars', 'synthwave', 'dark', 'terminal', 'old-pc']);
  const nextTheme = allowed.has(themeName) ? themeName : 'lcars';
  state.theme = nextTheme;
  document.documentElement.setAttribute('data-theme', nextTheme);
  document.body.setAttribute('data-theme', nextTheme);
  writePersistentStorage(STORAGE_KEYS.theme, nextTheme);
  applyThemeCopy(nextTheme);

  if (themeSwitcher instanceof HTMLSelectElement) {
    themeSwitcher.value = nextTheme;
  }
}

function updateClock() {
  const now = new Date();
  clockTime.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  clockDate.textContent = now.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });
}

function setMonitorShellCollapsed(shell, collapsed) {
  if (!(shell instanceof HTMLElement)) {
    return;
  }

  const shellId = shell.dataset.shellId || '';
  const header = shell.querySelector('.monitor-header');
  if (!(header instanceof HTMLElement) || !shellId) {
    return;
  }

  shell.classList.toggle('is-collapsed', collapsed);
  header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  header.setAttribute('title', collapsed ? 'Expand panel' : 'Collapse panel');
  state.collapsedShells[shellId] = collapsed;
  saveCollapsedShells();
}

function toggleMonitorShell(shell) {
  if (!(shell instanceof HTMLElement)) {
    return;
  }

  setMonitorShellCollapsed(shell, !shell.classList.contains('is-collapsed'));
}

function setupMonitorShells() {
  for (const shell of monitorShells) {
    const header = shell.querySelector('.monitor-header');
    if (!(header instanceof HTMLElement)) {
      continue;
    }

    const shellId = shell.dataset.shellId || '';
    if (shellId) {
      setMonitorShellCollapsed(shell, Boolean(state.collapsedShells[shellId]));
    }

    header.addEventListener('click', () => {
      toggleMonitorShell(shell);
    });

    header.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      event.preventDefault();
      toggleMonitorShell(shell);
    });
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function logStackTabDebug(stage, payload) {
  try {
    console.log(`[stack-debug] ${stage}`, payload);
  } catch {
    // Ignore logging failures.
  }
}

function shortHost(url) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function normalizeComparableUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return {
      origin: parsed.origin.toLowerCase(),
      hostname: parsed.hostname.toLowerCase(),
      pathname: path.toLowerCase()
    };
  } catch {
    return null;
  }
}

function isSimilarBookmarkUrl(targetUrl, candidateUrl) {
  const target = normalizeComparableUrl(targetUrl);
  const candidate = normalizeComparableUrl(candidateUrl);
  if (!target || !candidate) {
    return false;
  }
  if (target.hostname !== candidate.hostname) {
    return false;
  }
  if (target.origin !== candidate.origin) {
    return false;
  }
  if (target.pathname === candidate.pathname) {
    return true;
  }
  if (target.pathname === '/' || candidate.pathname === '/') {
    return true;
  }
  return target.pathname.startsWith(candidate.pathname) || candidate.pathname.startsWith(target.pathname);
}

function isStackFolderTitle(title) {
  return /^\s*\[stack\]\s*/i.test(String(title || ''));
}

function stripStackFolderPrefix(title) {
  return String(title || '').replace(/^\s*\[stack\]\s*/i, '').trim() || 'Bookmark Stack';
}

function collectBookmarkUrls(nodes) {
  const out = [];
  if (!Array.isArray(nodes)) {
    return out;
  }

  for (const node of nodes) {
    if (node?.url) {
      out.push({
        id: node.id || '',
        parentId: node.parentId || '',
        name: node.title || shortHost(node.url),
        url: node.url
      });
      continue;
    }

    if (Array.isArray(node?.children) && node.children.length) {
      out.push(...collectBookmarkUrls(node.children));
    }
  }

  return out;
}

function getFaviconUrls(url) {
  if (!url) {
    return [];
  }

  const urls = [];
  if (
    typeof chrome !== 'undefined' &&
    chrome.runtime &&
    typeof chrome.runtime.getURL === 'function'
  ) {
    const faviconUrl = new URL(chrome.runtime.getURL('/_favicon/'));
    faviconUrl.searchParams.set('pageUrl', url);
    faviconUrl.searchParams.set('size', '32');
    urls.push(faviconUrl.toString());
  }

  urls.push(
    `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(url)}&size=64`
  );
  return urls;
}

function setupCachedIcon(image, fallback, iconUrls) {
  const candidates = Array.from(new Set(
    (Array.isArray(iconUrls) ? iconUrls : [iconUrls]).filter(Boolean)
  ));
  fallback.classList.add('show');
  if (!candidates.length) {
    image.remove();
    return;
  }

  image.alt = '';
  image.decoding = 'async';
  image.loading = 'eager';
  image.referrerPolicy = 'no-referrer';
  image.addEventListener('load', () => {
    image.classList.add('show');
    fallback.classList.remove('show');
  }, { once: true });

  let candidateIndex = 0;
  const loadNextCandidate = () => {
    if (candidateIndex >= candidates.length) {
      image.remove();
      fallback.classList.add('show');
      return;
    }
    image.src = candidates[candidateIndex];
    candidateIndex += 1;
  };

  image.addEventListener('error', loadNextCandidate);
  loadNextCandidate();
}

function getMonogram(bookmark) {
  const source = shortHost(bookmark.url || bookmark.name || '');
  const chars = source.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase();
  return chars || '::';
}

function loadClicks() {
  try {
    const parsed = JSON.parse(readPersistentStorage(STORAGE_KEYS.clicks) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveClicks() {
  writePersistentStorage(STORAGE_KEYS.clicks, JSON.stringify(state.clicks));
}

function loadBookmarkOrder() {
  try {
    const parsed = JSON.parse(readPersistentStorage(STORAGE_KEYS.bookmarkOrder) || '[]');
    return Array.isArray(parsed) ? parsed.filter((key) => typeof key === 'string' && key) : [];
  } catch {
    return [];
  }
}

function saveBookmarkOrder() {
  writePersistentStorage(STORAGE_KEYS.bookmarkOrder, JSON.stringify(state.bookmarkOrder));
}

function loadTabActivity() {
  try {
    const parsed = JSON.parse(readPersistentStorage(STORAGE_KEYS.tabActivity) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveTabActivity() {
  writePersistentStorage(STORAGE_KEYS.tabActivity, JSON.stringify(state.tabActivity));
}

function loadCollapsedShells() {
  try {
    const parsed = JSON.parse(readPersistentStorage(STORAGE_KEYS.collapsedShells) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveCollapsedShells() {
  writePersistentStorage(STORAGE_KEYS.collapsedShells, JSON.stringify(state.collapsedShells));
}

function getTabActivityKey(tab) {
  const id = Number(tab?.id ?? tab?.tabId) || 0;
  return `${Number(tab?.windowId) || 0}:${id}`;
}

function noteTabActive(tabLike, timestamp = Date.now()) {
  const key = getTabActivityKey(tabLike);
  if (!key || key === '0:0') {
    return;
  }
  state.tabActivity[key] = timestamp;
}

function pruneTabActivity(tabs) {
  const keep = new Set((tabs || []).map((tab) => getTabActivityKey(tab)));
  let changed = false;

  for (const key of Object.keys(state.tabActivity)) {
    if (!keep.has(key)) {
      delete state.tabActivity[key];
      changed = true;
    }
  }

  if (changed) {
    saveTabActivity();
  }
}

function getBookmarkClicks(url) {
  return Number(state.clicks[url] || 0);
}

function getHeatTier(clicks, maxClicks) {
  if (clicks <= 0) {
    return 0;
  }
  if (maxClicks <= 1) {
    return 1;
  }

  const ratio = clicks / maxClicks;
  if (ratio >= 0.75 || clicks >= 25) return 4;
  if (ratio >= 0.45 || clicks >= 12) return 3;
  if (ratio >= 0.2 || clicks >= 5) return 2;
  return 1;
}

function getHeatProgress(clicks, maxClicks) {
  if (clicks <= 0 || maxClicks <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((clicks / maxClicks) * 100)));
}

function utf8ToBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToUtf8(value) {
  const binary = atob(value.trim());
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function sha256Hex(value) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function unixConvert(value) {
  const raw = String(value || '').trim();
  const candidate = raw || String(Math.floor(Date.now() / 1000));

  let date;
  if (/^-?\d+(\.\d+)?$/.test(candidate)) {
    const numeric = Number(candidate);
    const ms = Math.abs(numeric) < 1e11 ? numeric * 1000 : numeric;
    date = new Date(ms);
  } else {
    date = new Date(candidate);
  }

  if (Number.isNaN(date.getTime())) {
    return 'Invalid date/time input';
  }

  const ms = date.getTime();
  const sec = Math.floor(ms / 1000);
  return [
    `unix_s: ${sec}`,
    `unix_ms: ${ms}`,
    `iso: ${date.toISOString()}`,
    `local: ${date.toString()}`
  ].join('\n');
}

function updateCalcUi() {
  if (!calcModeBar || !calcDirectionBtn || !calcHint) {
    return;
  }

  const buttons = calcModeBar.querySelectorAll('.calc-mode-btn');
  for (const button of buttons) {
    button.classList.toggle('active', button.dataset.mode === state.calcMode);
  }

  const directional = state.calcMode === 'base64' || state.calcMode === 'url';
  calcDirectionBtn.disabled = !directional;
  calcDirectionBtn.style.opacity = directional ? '1' : '0.6';
  calcDirectionBtn.textContent = directional
    ? (state.calcDirection === 'encode' ? 'Encode' : 'Decode')
    : 'N/A';

  if (state.calcMode === 'base64') {
    calcHint.textContent = 'Mode: Base64 (UTF-8)';
  } else if (state.calcMode === 'url') {
    calcHint.textContent = 'Mode: URL Component';
  } else if (state.calcMode === 'sha256') {
    calcHint.textContent = 'Mode: SHA-256 Hex Digest';
  } else {
    calcHint.textContent = 'Mode: Unix Time Converter';
  }
}

function updateCalcStats(output, latencyMs) {
  const text = String(output || '');
  if (calcChars) {
    calcChars.textContent = `Chars: ${text.length.toLocaleString()}`;
  }
  if (calcLines) {
    const lines = text.length ? text.split(/\r?\n/).length : 0;
    calcLines.textContent = `Lines: ${lines.toLocaleString()}`;
  }
  if (calcBytes) {
    const bytes = new TextEncoder().encode(text).length;
    calcBytes.textContent = `Bytes: ${bytes.toLocaleString()}`;
  }
  if (calcLatency) {
    calcLatency.textContent = `Latency: ${Math.max(0, Math.round(latencyMs)).toLocaleString()} ms`;
  }
}

async function runCalculator() {
  if (!calcInput || !calcOutput) {
    return;
  }

  const token = ++state.calcToken;
  const input = calcInput.value;
  const startedAt = performance.now();

  try {
    let output = '';
    if (state.calcMode === 'base64') {
      output = state.calcDirection === 'encode' ? utf8ToBase64(input) : base64ToUtf8(input);
    } else if (state.calcMode === 'url') {
      output = state.calcDirection === 'encode' ? encodeURIComponent(input) : decodeURIComponent(input);
    } else if (state.calcMode === 'sha256') {
      output = await sha256Hex(input);
    } else {
      output = unixConvert(input);
    }

    if (token === state.calcToken) {
      calcOutput.value = output;
      updateCalcStats(output, performance.now() - startedAt);
    }
  } catch (error) {
    if (token === state.calcToken) {
      const errorText = `Error: ${String(error && error.message ? error.message : error)}`;
      calcOutput.value = errorText;
      updateCalcStats(errorText, performance.now() - startedAt);
    }
  }
}

async function hasBookmarksPermission() {
  if (typeof chrome !== 'undefined' && chrome.permissions && chrome.permissions.contains) {
    return new Promise((resolve) => {
      chrome.permissions.contains({ permissions: ['bookmarks'] }, (granted) => {
        resolve(Boolean(granted));
      });
    });
  }

  if (typeof browser !== 'undefined' && browser.permissions && browser.permissions.contains) {
    try {
      return await browser.permissions.contains({ permissions: ['bookmarks'] });
    } catch {
      return false;
    }
  }

  return false;
}

async function hasTabsPermission() {
  return typeof chrome !== 'undefined'
    ? Boolean(chrome.tabs && chrome.tabs.query)
    : Boolean(typeof browser !== 'undefined' && browser.tabs && browser.tabs.query);
}

function getTabsApi() {
  if (typeof chrome !== 'undefined' && chrome.tabs) {
    return chrome.tabs;
  }
  if (typeof browser !== 'undefined' && browser.tabs) {
    return browser.tabs;
  }
  return null;
}

function getWindowsApi() {
  if (typeof chrome !== 'undefined' && chrome.windows) {
    return chrome.windows;
  }
  if (typeof browser !== 'undefined' && browser.windows) {
    return browser.windows;
  }
  return null;
}

async function queryTabs(queryInfo) {
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
    return new Promise((resolve, reject) => {
      chrome.tabs.query(queryInfo, (result) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result || []);
        }
      });
    });
  }

  if (typeof browser !== 'undefined' && browser.tabs && browser.tabs.query) {
    return browser.tabs.query(queryInfo);
  }

  return [];
}

async function getCurrentBrowserTab() {
  const primary = await queryTabs({ active: true, currentWindow: true }).catch(() => []);
  if (Array.isArray(primary) && primary.length) {
    return primary[0];
  }

  const focused = await queryTabs({ active: true, lastFocusedWindow: true }).catch(() => []);
  if (Array.isArray(focused) && focused.length) {
    return focused[0];
  }

  const allTabs = await queryTabs({}).catch(() => []);
  if (Array.isArray(allTabs) && allTabs.length) {
    const exactUrl = String(location.href || '');
    const matchedByUrl = allTabs.find((tab) => String(tab?.url || tab?.pendingUrl || '') === exactUrl);
    if (matchedByUrl) {
      return matchedByUrl;
    }
  }

  return null;
}

async function getCurrentTabInfo() {
  const tab = await getCurrentBrowserTab().catch(() => null);
  if (!tab) {
    return null;
  }

  return {
    tabId: Number(tab.id) || 0,
    windowId: Number(tab.windowId) || 0,
    index: Number.isInteger(tab.index) ? tab.index : 0
  };
}

