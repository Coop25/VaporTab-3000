// Open tabs data, rendering, activation, closing, and placement helpers
function normalizeTabEntry(tab) {
  const url = String(tab?.url || tab?.pendingUrl || '');
  const title = String(tab?.title || tab?.pendingUrl || 'Untitled tab');
  const windowId = Number(tab?.windowId) || 0;
  const id = Number(tab?.id) || 0;
  const activityKey = `${windowId}:${id}`;
  const lastActiveAt = Number(state.tabActivity[activityKey] || 0);
  return {
    id,
    windowId,
    index: Number.isFinite(tab?.index) ? tab.index : 0,
    active: Boolean(tab?.active),
    audible: Boolean(tab?.audible),
    muted: Boolean(tab?.mutedInfo?.muted),
    discarded: Boolean(tab?.discarded),
    pinned: Boolean(tab?.pinned),
    title,
    url,
    host: shortHost(url || 'chrome://newtab'),
    lastActiveAt
  };
}

async function fetchBrowserTabs() {
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
    const tabs = await new Promise((resolve, reject) => {
      chrome.tabs.query({}, (result) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result || []);
        }
      });
    });

    return tabs.map(normalizeTabEntry);
  }

  if (typeof browser !== 'undefined' && browser.tabs && browser.tabs.query) {
    const tabs = await browser.tabs.query({});
    return tabs.map(normalizeTabEntry);
  }

  throw new Error('No browser tabs API found in this context.');
}

async function focusBrowserTab(tabId, windowId) {
  if (!Number.isInteger(tabId)) {
    return;
  }

  const tabsApi = getTabsApi();
  const windowsApi = getWindowsApi();

  try {
    if (windowsApi && Number.isInteger(windowId)) {
      if (typeof chrome !== 'undefined' && windowsApi.update) {
        await new Promise((resolve, reject) => {
          windowsApi.update(windowId, { focused: true }, () => {
            if (chrome.runtime && chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve();
            }
          });
        });
      } else if (typeof browser !== 'undefined' && windowsApi.update) {
        await windowsApi.update(windowId, { focused: true });
      }
    }

    if (tabsApi && tabsApi.update) {
      if (typeof chrome !== 'undefined') {
        await new Promise((resolve, reject) => {
          tabsApi.update(tabId, { active: true }, () => {
            if (chrome.runtime && chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve();
            }
          });
        });
      } else if (typeof browser !== 'undefined') {
        await tabsApi.update(tabId, { active: true });
      }
    }
  } catch {
    // Keep the terminal usable even if the browser rejects a focus request.
  }
}

async function closeBrowserTab(tabId) {
  if (!Number.isInteger(tabId)) {
    return;
  }

  const tabsApi = getTabsApi();
  if (!tabsApi || !tabsApi.remove) {
    return;
  }

  try {
    if (typeof chrome !== 'undefined') {
      await new Promise((resolve, reject) => {
        tabsApi.remove(tabId, () => {
          if (chrome.runtime && chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
    } else if (typeof browser !== 'undefined') {
      await tabsApi.remove(tabId);
    }
  } catch {
    // Ignore close failures and let the next refresh reconcile the UI.
  }
}

async function moveBrowserTab(tabId, index, windowId) {
  if (!Number.isInteger(tabId) || !Number.isInteger(index)) {
    return null;
  }

  const tabsApi = getTabsApi();
  if (!tabsApi || !tabsApi.move) {
    return null;
  }

  try {
    if (typeof chrome !== 'undefined') {
      return await new Promise((resolve, reject) => {
        const moveOptions = Number.isInteger(windowId) ? { windowId, index } : { index };
        logStackTabDebug('move-request', { tabId, moveOptions });
        tabsApi.move(tabId, moveOptions, (tab) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(tab || null);
          }
        });
      });
    }

    if (typeof browser !== 'undefined') {
      logStackTabDebug('move-request', { tabId, moveOptions: Number.isInteger(windowId) ? { windowId, index } : { index } });
      return await tabsApi.move(tabId, { windowId, index });
    }
  } catch (error) {
    logStackTabDebug('move-error', {
      tabId,
      index,
      windowId,
      error: error && error.message ? error.message : 'move failed'
    });
    return null;
  }

  return null;
}

async function moveExistingTabToCurrentWindow(matchTab, options = {}) {
  if (!matchTab || !Number.isInteger(matchTab.id)) {
    return null;
  }

  const currentTab = await getCurrentBrowserTab().catch(() => null);
  const currentId = Number(currentTab?.id) || 0;
  const currentWindowId = Number(currentTab?.windowId) || 0;
  const currentIndex = Number.isInteger(currentTab?.index) ? currentTab.index : 0;
  const sourceWindowId = Number(matchTab?.windowId) || 0;
  const closeCurrent = options.closeCurrent === true;
  const activateMoved = options.activateMoved !== false;
  const targetIndex = Number.isInteger(options.targetIndex) ? options.targetIndex : currentIndex + 1;

  if (currentId && currentId === matchTab.id) {
    if (closeCurrent) {
      return true;
    }
    return matchTab;
  }

  if (sourceWindowId && currentWindowId && sourceWindowId !== currentWindowId) {
    const sourceTabs = await queryTabs({ windowId: sourceWindowId }).catch(() => []);
    const sourceList = Array.isArray(sourceTabs) ? sourceTabs : [];
    const sourceTab = sourceList.find((tab) => Number(tab?.id) === matchTab.id) || null;
    const sourceTabCount = sourceList.length;

    if (sourceTabCount > 1 && sourceTab?.active) {
      const nextSourceTab = sourceList.find((tab) => Number(tab?.id) !== matchTab.id) || null;
      if (nextSourceTab) {
        await focusBrowserTab(Number(nextSourceTab.id) || 0, sourceWindowId);
      }
    }
  }

  const movedTab = await moveBrowserTab(matchTab.id, targetIndex, currentWindowId || sourceWindowId);
  const resolvedTab = movedTab || matchTab;

  if (activateMoved) {
    await focusBrowserTab(resolvedTab.id, currentWindowId || Number(resolvedTab.windowId) || 0);
  }

  if (closeCurrent && currentId) {
    await closeBrowserTab(currentId);
    return true;
  }

  return resolvedTab;
}

async function activateExistingTabAndCloseCurrent(matchTab) {
  const result = await moveExistingTabToCurrentWindow(matchTab, {
    closeCurrent: true,
    activateMoved: true
  });
  return Boolean(result);
}

function renderTabsSummary() {
  if (!tabsSummary) {
    return;
  }

  const tabCount = state.tabs.length;
  if (!tabCount) {
    tabsSummary.textContent = 'No visible tabs found';
    return;
  }

  const windowCount = new Set(state.tabs.map((tab) => tab.windowId)).size;
  const audibleCount = state.tabs.filter((tab) => tab.audible).length;
  tabsSummary.textContent = `${tabCount} tabs across ${windowCount} windows | ${audibleCount > 0 ? `${audibleCount} playing audio` : 'silent'}`;
}

function formatRelativeAge(timestamp, isActive) {
  if (isActive) {
    return 'Active now';
  }
  if (!timestamp) {
    return 'Last active unknown';
  }

  const diffMs = Math.max(0, Date.now() - timestamp);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return `Seen ${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `Seen ${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `Seen ${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `Seen ${days}d ago`;
}

function renderTabsList() {
  if (!tabsList) {
    return;
  }

  tabsList.innerHTML = '';
  renderTabsSummary();

  if (!state.tabs.length) {
    if (tabsCount) {
      tabsCount.textContent = '0 shown';
    }
    if (tabsToggleBtn) {
      tabsToggleBtn.hidden = true;
    }
    const empty = document.createElement('p');
    empty.className = 'status-empty';
    empty.textContent = 'Tabs are unavailable in this context.';
    tabsList.appendChild(empty);
    return;
  }

  const items = state.tabs
    .slice()
    .sort((a, b) => {
      if (a.active !== b.active) {
        return a.active ? -1 : 1;
      }
      if (a.audible !== b.audible) {
        return a.audible ? -1 : 1;
      }
      if (a.windowId !== b.windowId) {
        return a.windowId - b.windowId;
      }
      return a.index - b.index;
    });
  const visibleItems = state.tabsExpanded ? items : items.slice(0, VISIBLE_TABS_COLLAPSED);

  if (tabsCount) {
    tabsCount.textContent = `${visibleItems.length}/${items.length} shown`;
  }
  if (tabsHelperText) {
    const audibleCount = items.filter((tab) => tab.audible).length;
    tabsHelperText.textContent = audibleCount > 0
      ? `${audibleCount} tabs are currently playing audio.`
      : 'Click any tab card to jump to it.';
  }

  for (const tab of visibleItems) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab-item';
    if (tab.active) {
      button.classList.add('is-active');
    }
    if (tab.audible) {
      button.classList.add('is-audible');
    }

    const top = document.createElement('div');
    top.className = 'tab-item-top';

    const head = document.createElement('div');
    head.className = 'tab-head';

    const favicon = document.createElement('img');
    favicon.className = 'tab-favicon';
    const faviconUrls = getFaviconUrls(tab.url || 'chrome://newtab');
    let faviconIndex = 0;
    favicon.src = faviconUrls[faviconIndex];
    favicon.alt = '';
    favicon.loading = 'lazy';
    favicon.decoding = 'async';
    favicon.referrerPolicy = 'no-referrer';

    const fallback = document.createElement('span');
    fallback.className = 'tab-fallback';
    fallback.textContent = getMonogram({ url: tab.url, name: tab.title });

    favicon.addEventListener('error', () => {
      faviconIndex += 1;
      if (faviconIndex < faviconUrls.length) {
        favicon.src = faviconUrls[faviconIndex];
        return;
      }
      favicon.style.display = 'none';
      fallback.classList.add('show');
    });

    const name = document.createElement('p');
    name.className = 'tab-title';
    name.textContent = tab.title;

    head.appendChild(favicon);
    head.appendChild(fallback);
    head.appendChild(name);

    const badges = document.createElement('div');
    badges.className = 'tab-badges';

    if (tab.audible) {
      const audio = document.createElement('span');
      audio.className = 'tab-badge audible';
      audio.textContent = tab.muted ? 'AUDIO MUTED' : 'AUDIO LIVE';
      badges.appendChild(audio);
    }

    if (tab.pinned) {
      const pinned = document.createElement('span');
      pinned.className = 'tab-badge';
      pinned.textContent = 'PIN';
      badges.appendChild(pinned);
    }

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'tab-close';
    closeBtn.textContent = 'X';
    closeBtn.setAttribute('aria-label', `Close ${tab.title}`);
    closeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      event.preventDefault();
      closeBrowserTab(tab.id);
    });

    top.appendChild(head);
    if (badges.childElementCount > 0) {
      top.appendChild(badges);
    }
    top.appendChild(closeBtn);

    const line = document.createElement('p');
    line.className = 'tab-url';
    line.textContent = tab.url || 'Internal browser page';
    line.title = tab.url || 'Internal browser page';

    const meta = document.createElement('div');
    meta.className = 'tab-meta';

    const host = document.createElement('p');
    host.className = 'tab-host';
    host.textContent = tab.host;

    const activeAge = document.createElement('p');
    activeAge.className = 'tab-age';
    activeAge.textContent = formatRelativeAge(tab.lastActiveAt, tab.active);

    meta.appendChild(host);
    meta.appendChild(activeAge);

    button.appendChild(top);
    button.appendChild(line);
    button.appendChild(meta);
    button.addEventListener('click', () => {
      focusBrowserTab(tab.id, tab.windowId);
    });
    tabsList.appendChild(button);
  }

  if (tabsToggleBtn) {
    if (items.length > VISIBLE_TABS_COLLAPSED) {
      tabsToggleBtn.hidden = false;
      tabsToggleBtn.textContent = state.tabsExpanded ? 'Show fewer' : `Show all (${items.length})`;
    } else {
      tabsToggleBtn.hidden = true;
    }
  }
}

async function loadTabs() {
  try {
    if (!(await hasTabsPermission())) {
      state.tabs = [];
      renderTabsList();
      if (tabsSummary) {
        tabsSummary.textContent = 'Tabs API unavailable in this context';
      }
      return;
    }

    state.tabs = await fetchBrowserTabs();
    let activityChanged = false;
    for (const tab of state.tabs) {
      if (tab.active && !tab.lastActiveAt) {
        noteTabActive(tab);
        tab.lastActiveAt = Number(state.tabActivity[getTabActivityKey(tab)] || Date.now());
        activityChanged = true;
      }
    }
    pruneTabActivity(state.tabs);
    if (activityChanged) {
      saveTabActivity();
    }
  } catch (error) {
    state.tabs = [];
    renderTabsList();
    if (tabsSummary) {
      const detail = String(error?.message || 'Permission unavailable');
      tabsSummary.textContent = `Tabs unavailable: ${detail}`;
    }
    return;
  }

  renderTabsList();
}

function scheduleTabsReload() {
  if (state.tabsReloadTimer) {
    clearTimeout(state.tabsReloadTimer);
  }

  state.tabsReloadTimer = setTimeout(() => {
    state.tabsReloadTimer = null;
    loadTabs();
  }, 200);
}

function setupTabListeners() {
  if (state.tabListenersAttached) {
    return;
  }

  const tabsApi = getTabsApi();
  if (!tabsApi) {
    return;
  }

  const events = [
    tabsApi.onActivated,
    tabsApi.onAttached,
    tabsApi.onCreated,
    tabsApi.onDetached,
    tabsApi.onMoved,
    tabsApi.onRemoved,
    tabsApi.onReplaced,
    tabsApi.onUpdated
  ].filter(Boolean);

  for (const eventSource of events) {
    if (typeof eventSource.addListener === 'function') {
      eventSource.addListener(scheduleTabsReload);
    }
  }

  if (tabsApi.onActivated && typeof tabsApi.onActivated.addListener === 'function') {
    tabsApi.onActivated.addListener((activeInfo) => {
      noteTabActive(activeInfo);
      saveTabActivity();
    });
  }

  state.tabListenersAttached = events.length > 0;
}

