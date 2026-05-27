// Status sources, GitHub watch, and status-related modals
function setBookmarkNoticeMode(mode) {
  if (!footerNote) {
    return;
  }

  if (mode === 'ok') {
    footerNote.hidden = true;
    helperText.textContent = '';
    return;
  }

  if (mode === 'fallback-with-permission') {
    footerNote.hidden = true;
    helperText.textContent = 'Using fallback bookmarks in this context.';
    return;
  }

  footerNote.hidden = false;
  helperText.textContent = 'Live browser bookmarks are unavailable here. Use extension/new-tab context with bookmarks permission.';
}

function readStatusSources() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.statusSources) || '[]');
    if (!Array.isArray(parsed) || !parsed.length) {
      return DEFAULT_STATUS_SOURCES.slice();
    }

    return parsed
      .map((item) => normalizeStatusSource(item.name, item.url))
      .filter(Boolean);
  } catch {
    return DEFAULT_STATUS_SOURCES.slice();
  }
}

function saveStatusSources() {
  localStorage.setItem(STORAGE_KEYS.statusSources, JSON.stringify(state.statusSources));
}

function normalizeStatusSource(nameInput, urlInput) {
  const urlRaw = String(urlInput || '').trim();
  if (!urlRaw) {
    return null;
  }

  let resolvedUrl = urlRaw;
  if (!/^[a-z]+:\/\//i.test(resolvedUrl)) {
    resolvedUrl = `https://${resolvedUrl}`;
  }

  try {
    const parsed = new URL(resolvedUrl);
    const cleanName = String(nameInput || '').trim() || parsed.hostname.replace(/^www\./, '');
    return {
      id: `${cleanName.toLowerCase()}::${parsed.hostname.toLowerCase()}`,
      name: cleanName,
      url: parsed.toString()
    };
  } catch {
    return null;
  }
}

function getStatusApiUrl(url) {
  const parsed = new URL(url);
  const alreadyApi = /\/api\/v2\/status\.json\/?$/i.test(parsed.pathname);
  if (alreadyApi) {
    return parsed.toString();
  }

  parsed.pathname = '/api/v2/status.json';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function getStatusTone(indicator) {
  const value = String(indicator || '').toLowerCase();
  if (value === 'none' || value === 'operational') {
    return 'ok';
  }
  if (value === 'major' || value === 'critical') {
    return 'down';
  }
  return 'warn';
}

function fullDaysBetween(start, end) {
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    return 0;
  }
  return Math.max(0, Math.floor((endTime - startTime) / 86400000));
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function getIncidentAnchor(url) {
  try {
    return new URL(url).toString();
  } catch {
    return GITHUB_STATUS_HISTORY_URL;
  }
}

async function fetchStatus(source) {
  const endpoint = getStatusApiUrl(source.url);
  const startedAt = Date.now();

  try {
    const res = await fetch(endpoint, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    const description = data?.status?.description || 'Unknown';
    const indicator = data?.status?.indicator || 'unknown';
    return {
      ok: true,
      tone: getStatusTone(indicator),
      description,
      checkedAt: startedAt
    };
  } catch (error) {
    return {
      ok: false,
      tone: 'down',
      description: String(error?.message || 'Unavailable'),
      checkedAt: startedAt
    };
  }
}

function renderGitHubIncidentCard() {
  if (!githubIncidentDays || !githubIncidentBadge || !githubIncidentRange || !githubIncidentSummary || !githubIncidentHighScore) {
    return;
  }

  const info = state.githubIncident;

  if (!info) {
    githubIncidentDays.textContent = '--';
    githubIncidentBadge.className = 'status-badge warn';
    githubIncidentBadge.textContent = 'SYNC';
    githubIncidentRange.textContent = 'Days without a GitHub incident';
    githubIncidentSummary.textContent = 'Loading GitHub status and incident history...';
    githubIncidentHighScore.textContent = 'High score this year: --';
    if (githubIncidentLink) {
      githubIncidentLink.href = GITHUB_STATUS_HISTORY_URL;
    }
    return;
  }

  githubIncidentDays.textContent = String(info.currentStreakDays ?? '--');
  githubIncidentBadge.className = `status-badge ${info.tone || 'warn'}`;
  githubIncidentBadge.textContent = info.badgeText || 'SYNC';
  githubIncidentRange.textContent = info.rangeLabel || 'Days without a GitHub incident';
  githubIncidentSummary.textContent = info.summary || 'GitHub status unavailable.';
  githubIncidentHighScore.textContent = info.highScoreLabel || 'High score this year: --';

  if (githubIncidentLink) {
    githubIncidentLink.href = info.link || GITHUB_STATUS_HISTORY_URL;
  }
}

function renderStatusList() {
  statusList.innerHTML = '';

  if (!state.statusSources.length) {
    const empty = document.createElement('p');
    empty.className = 'status-empty';
    empty.textContent = 'No status sources configured.';
    statusList.appendChild(empty);
    updateStatusPulse();
    return;
  }

  for (const source of state.statusSources) {
    const status = state.statusById.get(source.id);

    const row = document.createElement('div');
    row.className = 'status-item';

    const top = document.createElement('div');
    top.className = 'status-top';

    const name = document.createElement('p');
    name.className = 'status-name';
    name.textContent = source.name;

    const badge = document.createElement('span');
    badge.className = `status-badge ${status ? status.tone : 'warn'}`;
    badge.textContent = status ? (status.ok ? 'LIVE' : 'ERR') : '...';

    top.appendChild(name);
    top.appendChild(badge);

    const line = document.createElement('p');
    line.className = 'status-line';
    line.textContent = status ? status.description : 'Fetching...';

    const meta = document.createElement('div');
    meta.className = 'status-meta';

    const host = document.createElement('span');
    host.textContent = shortHost(source.url);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'status-remove';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      state.statusById.delete(source.id);
      state.statusSources = state.statusSources.filter((item) => item.id !== source.id);
      saveStatusSources();
      renderStatusList();
    });

    meta.appendChild(host);
    meta.appendChild(removeBtn);

    row.appendChild(top);
    row.appendChild(line);
    row.appendChild(meta);
    statusList.appendChild(row);
  }

  updateStatusPulse();
}

function updateStatusPulse() {
  if (!statusPulse || !statusPulseText) {
    return;
  }

  const total = state.statusSources.length;
  if (!total) {
    statusPulse.classList.remove('ok', 'down');
    statusPulse.classList.add('warn');
    statusPulseText.textContent = 'NET STATUS: NO SOURCES';
    return;
  }

  let live = 0;
  let down = 0;
  let pending = 0;

  for (const source of state.statusSources) {
    const status = state.statusById.get(source.id);
    if (!status) {
      pending += 1;
      continue;
    }
    if (status.ok) {
      live += 1;
    } else {
      down += 1;
    }
  }

  statusPulse.classList.remove('ok', 'warn', 'down');

  if (down > 0) {
    statusPulse.classList.add('down');
    statusPulseText.textContent = `NET STATUS: ${down} DOWN / ${total}`;
    return;
  }

  if (pending > 0) {
    statusPulse.classList.add('warn');
    statusPulseText.textContent = `NET STATUS: SYNCING ${total}`;
    return;
  }

  statusPulse.classList.add('ok');
  statusPulseText.textContent = `NET STATUS: ${live}/${total} LIVE`;
}

function formatCountdown(ms) {
  const safe = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateStatusRefreshMeta() {
  if (!statusRefreshMeta) {
    return;
  }
  if (state.statusIsRefreshing) {
    statusRefreshMeta.textContent = 'Refreshing status feed...';
    return;
  }
  if (!state.statusSources.length) {
    statusRefreshMeta.textContent = 'No sources configured';
    return;
  }

  const remaining = state.statusNextRefreshAt - Date.now();
  statusRefreshMeta.textContent = `Next auto refresh in ${formatCountdown(remaining)}`;
}

function updateGitHubIncidentMeta() {
  if (!githubIncidentMeta) {
    return;
  }

  if (state.githubIncidentIsRefreshing) {
    githubIncidentMeta.textContent = 'Refreshing GitHub incident feed...';
    return;
  }

  const info = state.githubIncident;
  if (!info?.checkedAt) {
    githubIncidentMeta.textContent = 'Checking incident feed...';
    return;
  }

  githubIncidentMeta.textContent = `Last sync ${formatDateTime(info.checkedAt)}`;
}

function setRefreshUi(refreshing) {
  if (refreshStatusBtn) {
    refreshStatusBtn.disabled = refreshing;
    refreshStatusBtn.classList.toggle('is-loading', refreshing);
    refreshStatusBtn.textContent = refreshing ? 'Refreshing...' : 'Refresh';
  }
  if (statusConsole) {
    statusConsole.classList.toggle('is-refreshing', refreshing);
  }
  updateStatusRefreshMeta();
}

async function refreshGitHubIncidentCard() {
  if (state.githubIncidentIsRefreshing) {
    return;
  }

  state.githubIncidentIsRefreshing = true;
  updateGitHubIncidentMeta();

  const startedAt = Date.now();

  try {
    const [statusRes, incidentsRes] = await Promise.all([
      fetch(GITHUB_STATUS_API_URL, { cache: 'no-store' }),
      fetch(GITHUB_INCIDENTS_API_URL, { cache: 'no-store' })
    ]);

    if (!statusRes.ok) {
      throw new Error(`Status HTTP ${statusRes.status}`);
    }
    if (!incidentsRes.ok) {
      throw new Error(`Incidents HTTP ${incidentsRes.status}`);
    }

    const statusData = await statusRes.json();
    const incidentsData = await incidentsRes.json();
    const incidents = Array.isArray(incidentsData?.incidents)
      ? incidentsData.incidents
          .filter((incident) => incident?.created_at)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      : [];

    const latestIncident = incidents[0] || null;
    const latestEnd = latestIncident?.resolved_at || latestIncident?.created_at || null;
    const currentStreakDays = latestEnd ? fullDaysBetween(latestEnd, Date.now()) : 0;
    const statusDescription = statusData?.status?.description || 'Unknown';
    const indicator = statusData?.status?.indicator || 'unknown';
    const tone = getStatusTone(indicator);

    const currentYear = new Date().getFullYear();
    let highScore = currentStreakDays;

    for (let index = 0; index < incidents.length - 1; index += 1) {
      const newer = incidents[index];
      const older = incidents[index + 1];
      const newerStart = newer?.created_at;
      const olderEnd = older?.resolved_at || older?.created_at;

      if (!newerStart || !olderEnd) {
        continue;
      }

      const newerYear = new Date(newerStart).getFullYear();
      if (newerYear !== currentYear) {
        continue;
      }

      highScore = Math.max(highScore, fullDaysBetween(olderEnd, newerStart));
    }

    const lastIncidentName = latestIncident?.name || 'No recent incidents found';
    const lastIncidentWhen = latestIncident?.created_at ? formatDateTime(latestIncident.created_at) : 'Unknown';
    const incidentLink = getIncidentAnchor(latestIncident?.shortlink || GITHUB_STATUS_HISTORY_URL);

    state.githubIncident = {
      tone,
      badgeText: tone === 'ok' ? 'LIVE' : tone === 'down' ? 'ALERT' : 'WARN',
      currentStreakDays,
      rangeLabel: latestIncident
        ? `Last incident started ${lastIncidentWhen}`
        : 'No GitHub incidents found in feed',
      summary: `${statusDescription}. Last incident: ${lastIncidentName}.`,
      highScoreLabel: `High score this year: ${highScore} day${highScore === 1 ? '' : 's'}`,
      checkedAt: startedAt,
      link: incidentLink
    };
  } catch (error) {
    state.githubIncident = {
      tone: 'down',
      badgeText: 'ERR',
      currentStreakDays: '--',
      rangeLabel: 'GitHub incident feed unavailable',
      summary: String(error?.message || 'Could not reach GitHub status endpoints.'),
      highScoreLabel: 'High score this year: --',
      checkedAt: startedAt,
      link: GITHUB_STATUS_HISTORY_URL
    };
  } finally {
    state.githubIncidentIsRefreshing = false;
    renderGitHubIncidentCard();
    updateGitHubIncidentMeta();
  }
}

async function refreshOperationsSidebar() {
  await Promise.all([refreshStatuses(), refreshGitHubIncidentCard()]);
}

async function refreshStatuses() {
  if (state.statusIsRefreshing) {
    return;
  }

  state.statusIsRefreshing = true;
  setRefreshUi(true);

  try {
    if (!state.statusSources.length) {
      renderStatusList();
      state.statusNextRefreshAt = Date.now() + STATUS_REFRESH_MS;
      return;
    }

    renderStatusList();
    const results = await Promise.all(
      state.statusSources.map(async (source) => {
        const result = await fetchStatus(source);
        return { id: source.id, result };
      })
    );

    for (const entry of results) {
      state.statusById.set(entry.id, entry.result);
    }

    renderStatusList();
    state.statusNextRefreshAt = Date.now() + STATUS_REFRESH_MS;
  } finally {
    state.statusIsRefreshing = false;
    setRefreshUi(false);
  }
}

function addStatusSourceFromInputs() {
  const source = normalizeStatusSource(statusNameInput.value, statusUrlInput.value);
  if (!source) {
    statusUrlInput.focus();
    return;
  }

  const exists = state.statusSources.some((item) => item.id === source.id);
  if (!exists) {
    state.statusSources.push(source);
    saveStatusSources();
  }

  statusNameInput.value = '';
  statusUrlInput.value = '';
  closeStatusModal();
  refreshStatuses();
}

function openStatusModal() {
  if (!statusModal) {
    return;
  }
  statusModal.hidden = false;
  statusUrlInput.focus();
}

function closeStatusModal() {
  if (!statusModal) {
    return;
  }
  statusModal.hidden = true;
}

function resolveBookmarkMatchChoice(choice) {
  if (typeof state.bookmarkMatchResolver !== 'function') {
    return;
  }

  const resolver = state.bookmarkMatchResolver;
  state.bookmarkMatchResolver = null;
  state.bookmarkMatchPending = null;
  if (bookmarkMatchModal) {
    bookmarkMatchModal.hidden = true;
  }
  resolver(choice);
}

function closeBookmarkMatchModal() {
  resolveBookmarkMatchChoice({ type: 'cancel' });
}

function openBookmarkMatchModal(targetUrl, matches, options = {}) {
  if (!bookmarkMatchModal || !bookmarkMatchList || !bookmarkMatchCopy) {
    return Promise.resolve({ type: 'new' });
  }

  bookmarkMatchList.innerHTML = '';
  const host = shortHost(targetUrl);
  const existingAction = options.existingAction || 'activate';
  bookmarkMatchCopy.textContent = existingAction === 'activate'
    ? `Open a fresh instance for ${host}, or switch to one of these similar open tabs.`
    : `Open a fresh instance for ${host}, or reuse one of these similar open tabs already in the browser.`;

  for (const match of matches) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bookmark-match-item';
    if (match.active) {
      button.classList.add('is-active');
    }

    const top = document.createElement('div');
    top.className = 'bookmark-match-item-top';

    const title = document.createElement('p');
    title.className = 'bookmark-match-title';
    title.textContent = match.title || shortHost(match.url || targetUrl);

    const badge = document.createElement('span');
    badge.className = 'bookmark-match-badge';
    badge.textContent = match.active ? 'ACTIVE' : `WIN ${Number(match.windowId) || 0}`;

    top.appendChild(title);
    top.appendChild(badge);

    const url = document.createElement('p');
    url.className = 'bookmark-match-url';
    url.textContent = match.url || 'Internal browser page';

    const meta = document.createElement('p');
    meta.className = 'bookmark-match-meta';
    meta.textContent = existingAction === 'activate'
      ? 'Use current tab and close this new-tab page'
      : 'Keep using the existing tab for this stack step';

    button.appendChild(top);
    button.appendChild(url);
    button.appendChild(meta);
    button.addEventListener('click', () => {
      resolveBookmarkMatchChoice({ type: 'existing', tab: match });
    });
    bookmarkMatchList.appendChild(button);
  }

  bookmarkMatchModal.hidden = false;
  const firstButton = bookmarkMatchList.querySelector('.bookmark-match-item');
  if (firstButton instanceof HTMLElement) {
    firstButton.focus();
  }

  return new Promise((resolve) => {
    state.bookmarkMatchResolver = resolve;
    state.bookmarkMatchPending = { targetUrl, matches };
  });
}

async function maybeReuseOpenBookmarkTab(url, options = {}) {
  const currentTab = await getCurrentBrowserTab().catch(() => null);
  const currentId = Number(currentTab?.id) || 0;
  const openTabs = Array.isArray(options.candidateTabs)
    ? options.candidateTabs
    : await queryTabs({}).catch(() => []);
  const existingAction = options.existingAction || 'activate';
  const matches = (Array.isArray(openTabs) ? openTabs : [])
    .filter((tab) => Number(tab?.id) !== currentId)
    .filter((tab) => isSimilarBookmarkUrl(url, String(tab?.url || tab?.pendingUrl || '')))
    .map((tab) => ({
      id: Number(tab.id) || 0,
      windowId: Number(tab.windowId) || 0,
      title: String(tab.title || tab.pendingUrl || 'Existing tab'),
      url: String(tab.url || tab.pendingUrl || ''),
      active: Boolean(tab.active)
    }));

  logStackTabDebug('reuse-check', {
    url,
    existingAction,
    currentId,
    matchCount: matches.length,
    matches
  });

  if (!matches.length) {
    return false;
  }

  const choice = await openBookmarkMatchModal(url, matches, { existingAction });
  logStackTabDebug('reuse-choice', {
    url,
    existingAction,
    choice
  });
  if (!choice || choice.type === 'cancel') {
    return { handled: true, reusedExisting: false, cancelled: true };
  }
  if (choice.type === 'existing' && choice.tab) {
    if (existingAction === 'activate') {
      await activateExistingTabAndCloseCurrent(choice.tab);
    } else if (existingAction === 'keep') {
      await moveExistingTabToCurrentWindow(choice.tab, {
        closeCurrent: false,
        activateMoved: false,
        targetIndex: Number.isInteger(options.targetIndex) ? options.targetIndex : undefined
      });
    }
    return { handled: true, reusedExisting: true, cancelled: false };
  }
  if (choice.type === 'new') {
    return false;
  }
  return false;
}

