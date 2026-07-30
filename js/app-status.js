// Status sources, configurable incident watch, and status-related modals
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
    const parsed = JSON.parse(readPersistentStorage(STORAGE_KEYS.statusSources) || '[]');
    if (!Array.isArray(parsed) || !parsed.length) {
      return DEFAULT_STATUS_SOURCES
        .map((item) => normalizeStatusSource(item.name, item.url))
        .filter(Boolean);
    }

    return parsed
      .map((item) => normalizeStatusSource(item.name, item.url))
      .filter(Boolean);
  } catch {
    return DEFAULT_STATUS_SOURCES
      .map((item) => normalizeStatusSource(item.name, item.url))
      .filter(Boolean);
  }
}

function saveStatusSources() {
  writePersistentStorage(STORAGE_KEYS.statusSources, JSON.stringify(state.statusSources));
}

function getWatchSource() {
  return state.statusSources.find((source) => source.id === state.watchSourceId) || null;
}

function ensureWatchSourceSelection() {
  let source = getWatchSource();
  if (!source) {
    source = state.statusSources.find((item) => {
      try {
        return new URL(item.url).hostname.toLowerCase().includes('githubstatus.com');
      } catch {
        return false;
      }
    }) || state.statusSources[0] || null;
  }

  state.watchSourceId = source?.id || '';
  if (state.watchSourceId) {
    writePersistentStorage(STORAGE_KEYS.watchSource, state.watchSourceId);
  } else {
    removePersistentStorage(STORAGE_KEYS.watchSource);
  }
  return source;
}

function getStatusSiblingUrl(url, filename) {
  const parsed = new URL(url);
  parsed.pathname = `/api/v2/${filename}`;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function getStatusHistoryUrl(url) {
  const parsed = new URL(url);
  parsed.pathname = '/history';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function setWatchSource(sourceId) {
  if (!state.statusSources.some((source) => source.id === sourceId)) {
    return;
  }

  state.watchSourceId = sourceId;
  writePersistentStorage(STORAGE_KEYS.watchSource, sourceId);
  state.githubIncident = null;
  state.githubIncidentRefreshToken += 1;
  state.githubIncidentIsRefreshing = false;
  renderStatusList();
  renderGitHubIncidentCard();
  updateGitHubIncidentMeta();
  refreshGitHubIncidentCard();
}

function moveStatusSource(sourceId, targetIndex) {
  const currentIndex = state.statusSources.findIndex((item) => item.id === sourceId);
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= state.statusSources.length || currentIndex === targetIndex) {
    return;
  }

  const nextSources = state.statusSources.slice();
  const [source] = nextSources.splice(currentIndex, 1);
  nextSources.splice(targetIndex, 0, source);
  state.statusSources = nextSources;
  saveStatusSources();
  renderStatusList();
}

function clearStatusDropMarkers() {
  for (const row of statusList.querySelectorAll('.status-item.is-dragging, .status-item.drop-before, .status-item.drop-after')) {
    row.classList.remove('is-dragging', 'drop-before', 'drop-after');
  }
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

function getIncidentAnchor(url, fallbackUrl) {
  try {
    return new URL(url).toString();
  } catch {
    return fallbackUrl;
  }
}

function getFreshApiUrl(url, requestTime) {
  const parsed = new URL(url);
  parsed.searchParams.set('_lcars', String(requestTime));
  return parsed.toString();
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

  const source = getWatchSource();
  const sourceName = source?.name || 'Service';
  const historyUrl = source ? getStatusHistoryUrl(source.url) : GITHUB_STATUS_HISTORY_URL;
  const info = state.githubIncident?.sourceId === source?.id ? state.githubIncident : null;

  if (githubIncidentTitle) {
    githubIncidentTitle.textContent = `${sourceName} Watch`;
  }

  if (!info) {
    githubIncidentDays.textContent = '--';
    githubIncidentBadge.className = 'status-badge warn';
    githubIncidentBadge.textContent = source ? 'SYNC' : 'N/A';
    githubIncidentRange.textContent = source
      ? `Days without a ${sourceName} incident`
      : 'Choose a NET OPS source to watch';
    githubIncidentSummary.textContent = source
      ? `Loading ${sourceName} status and incident history...`
      : 'Add a NET OPS source, then select Watch in edit mode.';
    githubIncidentHighScore.textContent = 'High score this year: --';
    if (githubIncidentLink) {
      githubIncidentLink.href = historyUrl;
    }
    return;
  }

  githubIncidentDays.textContent = String(info.currentStreakDays ?? '--');
  githubIncidentBadge.className = `status-badge ${info.tone || 'warn'}`;
  githubIncidentBadge.textContent = info.badgeText || 'SYNC';
  githubIncidentRange.textContent = info.rangeLabel || `Days without a ${sourceName} incident`;
  githubIncidentSummary.textContent = info.summary || `${sourceName} status unavailable.`;
  githubIncidentHighScore.textContent = info.highScoreLabel || 'High score this year: --';

  if (githubIncidentLink) {
    githubIncidentLink.href = info.link || historyUrl;
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

  state.statusSources.forEach((source, sourceIndex) => {
    const status = state.statusById.get(source.id);

    const row = document.createElement('div');
    row.className = 'status-item';
    row.dataset.statusId = source.id;
    row.classList.toggle('is-watch-source', source.id === state.watchSourceId);
    if (state.statusEditMode) {
      row.classList.add('is-editable');
      row.draggable = true;
      row.tabIndex = 0;
      row.title = 'Drag to reorder';
      row.setAttribute('aria-label', `${source.name}. Drag to reorder, or use the arrow keys.`);
    }

    const dragIndicator = document.createElement('span');
    dragIndicator.className = 'status-drag-indicator';
    dragIndicator.setAttribute('aria-hidden', 'true');

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

    meta.appendChild(host);

    let controls = null;
    if (state.statusEditMode) {
      controls = document.createElement('div');
      controls.className = 'status-item-controls';

      row.addEventListener('keydown', (event) => {
        if (event.target !== row) {
          return;
        }
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
          return;
        }
        event.preventDefault();
        moveStatusSource(source.id, sourceIndex + (event.key === 'ArrowUp' ? -1 : 1));
        requestAnimationFrame(() => {
          const nextRow = Array.from(statusList.querySelectorAll('.status-item'))
            .find((candidate) => candidate.dataset.statusId === source.id);
          nextRow?.focus();
        });
      });
      row.addEventListener('dragstart', (event) => {
        if (!event.dataTransfer) {
          event.preventDefault();
          return;
        }
        state.draggedStatusId = source.id;
        row.classList.add('is-dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', source.id);
      });
      row.addEventListener('dragend', () => {
        state.draggedStatusId = '';
        clearStatusDropMarkers();
      });

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'status-item-action';
      editBtn.textContent = 'Edit';
      editBtn.setAttribute('aria-label', `Edit ${source.name}`);
      editBtn.addEventListener('click', () => openStatusModal(source.id));

      const watchBtn = document.createElement('button');
      const isWatchSource = source.id === state.watchSourceId;
      watchBtn.type = 'button';
      watchBtn.className = 'status-item-action status-watch-action';
      watchBtn.classList.toggle('is-active', isWatchSource);
      watchBtn.textContent = isWatchSource ? 'Watching' : 'Watch';
      watchBtn.disabled = isWatchSource;
      watchBtn.setAttribute('aria-label', isWatchSource
        ? `${source.name} is shown in the Watch card`
        : `Show ${source.name} in the Watch card`);
      watchBtn.addEventListener('click', () => setWatchSource(source.id));

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'status-remove';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        const removedWatchSource = state.watchSourceId === source.id;
        state.statusById.delete(source.id);
        state.statusSources = state.statusSources.filter((item) => item.id !== source.id);
        if (removedWatchSource) {
          ensureWatchSourceSelection();
          state.githubIncident = null;
          state.githubIncidentRefreshToken += 1;
          state.githubIncidentIsRefreshing = false;
        }
        saveStatusSources();
        renderStatusList();
        if (removedWatchSource) {
          refreshGitHubIncidentCard();
        }
      });

      controls.appendChild(editBtn);
      controls.appendChild(watchBtn);
      controls.appendChild(removeBtn);

      row.addEventListener('dragover', (event) => {
        if (!state.draggedStatusId || state.draggedStatusId === source.id) {
          return;
        }
        event.preventDefault();
        const bounds = row.getBoundingClientRect();
        const placeAfter = event.clientY >= bounds.top + bounds.height / 2;
        row.classList.toggle('drop-before', !placeAfter);
        row.classList.toggle('drop-after', placeAfter);
      });

      row.addEventListener('dragleave', () => {
        row.classList.remove('drop-before', 'drop-after');
      });

      row.addEventListener('drop', (event) => {
        event.preventDefault();
        const draggedId = state.draggedStatusId || event.dataTransfer?.getData('text/plain') || '';
        const draggedIndex = state.statusSources.findIndex((item) => item.id === draggedId);
        const targetIndex = state.statusSources.findIndex((item) => item.id === source.id);
        const bounds = row.getBoundingClientRect();
        const placeAfter = event.clientY >= bounds.top + bounds.height / 2;
        const insertionIndex = targetIndex + (placeAfter ? 1 : 0) - (draggedIndex < targetIndex ? 1 : 0);
        state.draggedStatusId = '';
        clearStatusDropMarkers();
        moveStatusSource(draggedId, insertionIndex);
      });
    }

    if (state.statusEditMode) {
      row.appendChild(dragIndicator);
    }
    row.appendChild(top);
    row.appendChild(line);
    row.appendChild(meta);
    if (controls) {
      row.appendChild(controls);
    }
    statusList.appendChild(row);
  });

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

  const sourceName = getWatchSource()?.name || 'service';
  if (state.githubIncidentIsRefreshing) {
    githubIncidentMeta.textContent = `Refreshing ${sourceName} incident feed...`;
    return;
  }

  const info = state.githubIncident;
  if (!info?.checkedAt) {
    githubIncidentMeta.textContent = getWatchSource()
      ? `Checking ${sourceName} incident feed...`
      : 'No watch source selected';
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

  const source = getWatchSource();
  if (!source) {
    state.githubIncident = null;
    renderGitHubIncidentCard();
    updateGitHubIncidentMeta();
    return;
  }

  const requestToken = ++state.githubIncidentRefreshToken;
  const historyUrl = getStatusHistoryUrl(source.url);
  state.githubIncidentIsRefreshing = true;
  updateGitHubIncidentMeta();

  const startedAt = Date.now();

  try {
    const requestOptions = {
      cache: 'no-store',
      credentials: 'omit'
    };
    const [statusRes, incidentsRes] = await Promise.all([
      fetch(getFreshApiUrl(getStatusApiUrl(source.url), startedAt), requestOptions),
      fetch(getFreshApiUrl(getStatusSiblingUrl(source.url, 'incidents.json'), startedAt), requestOptions)
        .catch(() => null)
    ]);

    if (!statusRes.ok) {
      throw new Error(`Status HTTP ${statusRes.status}`);
    }

    const statusData = await statusRes.json();
    let incidentsAvailable = Boolean(incidentsRes?.ok);
    let incidentsData = null;
    if (incidentsAvailable) {
      try {
        incidentsData = await incidentsRes.json();
      } catch {
        incidentsAvailable = false;
      }
    }
    const incidents = Array.isArray(incidentsData?.incidents)
      ? incidentsData.incidents
          .filter((incident) => incident?.created_at)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      : [];

    const latestIncident = incidents[0] || null;
    const latestResolvedAt = latestIncident?.resolved_at || null;
    const latestStartedAt = latestIncident?.started_at || latestIncident?.created_at || null;
    const latestEnd = latestResolvedAt || latestStartedAt;
    const incidentIsResolved = Boolean(latestResolvedAt);
    const currentStreakDays = incidentsAvailable
      ? (incidentIsResolved && latestEnd ? fullDaysBetween(latestEnd, startedAt) : 0)
      : '--';
    const statusDescription = statusData?.status?.description || 'Unknown';
    const indicator = statusData?.status?.indicator || 'unknown';
    const tone = getStatusTone(indicator);

    const currentYear = new Date().getFullYear();
    let highScore = typeof currentStreakDays === 'number' ? currentStreakDays : 0;

    for (let index = 0; index < incidents.length - 1; index += 1) {
      const newer = incidents[index];
      const older = incidents[index + 1];
      const newerStart = newer?.started_at || newer?.created_at;
      const olderEnd = older?.resolved_at || older?.started_at || older?.created_at;

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
    const lastIncidentWhen = latestEnd ? formatDateTime(latestEnd) : 'Unknown';
    const incidentLink = getIncidentAnchor(latestIncident?.shortlink || historyUrl, historyUrl);
    const incidentTimeLabel = incidentIsResolved ? 'resolved' : 'started';

    if (requestToken !== state.githubIncidentRefreshToken || source.id !== state.watchSourceId) {
      return;
    }

    state.githubIncident = {
      sourceId: source.id,
      tone,
      badgeText: tone === 'ok' ? 'LIVE' : tone === 'down' ? 'ALERT' : 'WARN',
      currentStreakDays,
      rangeLabel: !incidentsAvailable
        ? `${source.name} incident history unavailable`
        : latestIncident
          ? `Last incident ${incidentTimeLabel} ${lastIncidentWhen}`
          : `No ${source.name} incidents found in feed`,
      summary: incidentsAvailable
        ? `${statusDescription}. Last incident: ${lastIncidentName}.`
        : `${statusDescription}. Incident history is not exposed by this status page.`,
      highScoreLabel: incidentsAvailable
        ? `High score this year: ${highScore} day${highScore === 1 ? '' : 's'}`
        : 'High score this year: --',
      checkedAt: startedAt,
      link: incidentLink
    };
  } catch (error) {
    if (requestToken !== state.githubIncidentRefreshToken || source.id !== state.watchSourceId) {
      return;
    }

    state.githubIncident = {
      sourceId: source.id,
      tone: 'down',
      badgeText: 'ERR',
      currentStreakDays: '--',
      rangeLabel: `${source.name} incident feed unavailable`,
      summary: String(error?.message || `Could not reach ${source.name} status endpoints.`),
      highScoreLabel: 'High score this year: --',
      checkedAt: startedAt,
      link: historyUrl
    };
  } finally {
    if (requestToken === state.githubIncidentRefreshToken) {
      state.githubIncidentIsRefreshing = false;
      renderGitHubIncidentCard();
      updateGitHubIncidentMeta();
    }
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

  const editIndex = state.statusSources.findIndex((item) => item.id === state.editingStatusId);
  const duplicateIndex = state.statusSources.findIndex((item) => item.id === source.id);
  let watchSourceChanged = false;

  if (editIndex >= 0) {
    if (duplicateIndex >= 0 && duplicateIndex !== editIndex) {
      statusUrlInput.setCustomValidity('That status source already exists.');
      statusUrlInput.reportValidity();
      return;
    }

    const previousId = state.statusSources[editIndex].id;
    const editedWatchSource = state.watchSourceId === previousId;
    state.statusSources[editIndex] = source;
    if (previousId !== source.id && state.statusById.has(previousId)) {
      state.statusById.set(source.id, state.statusById.get(previousId));
      state.statusById.delete(previousId);
    }
    if (editedWatchSource) {
      watchSourceChanged = true;
      state.watchSourceId = source.id;
      writePersistentStorage(STORAGE_KEYS.watchSource, source.id);
      state.githubIncident = null;
      state.githubIncidentRefreshToken += 1;
      state.githubIncidentIsRefreshing = false;
    }
    saveStatusSources();
  } else if (duplicateIndex < 0) {
    state.statusSources.push(source);
    saveStatusSources();
  }

  statusNameInput.value = '';
  statusUrlInput.value = '';
  closeStatusModal();
  refreshStatuses();
  if (watchSourceChanged) {
    renderGitHubIncidentCard();
    refreshGitHubIncidentCard();
  }
}

function openStatusModal(sourceId = '') {
  if (!statusModal) {
    return;
  }

  const source = state.statusSources.find((item) => item.id === sourceId);
  state.editingStatusId = source?.id || '';
  statusNameInput.value = source?.name || '';
  statusUrlInput.value = source?.url || '';
  statusUrlInput.setCustomValidity('');
  statusModalTitle.textContent = source ? 'Edit Status Source' : 'Add Status Source';
  addStatusBtn.textContent = source ? 'Save Changes' : 'Add Source';
  statusModal.hidden = false;
  (source ? statusNameInput : statusUrlInput).focus();
}

function closeStatusModal() {
  if (!statusModal) {
    return;
  }
  statusModal.hidden = true;
  state.editingStatusId = '';
  statusNameInput.value = '';
  statusUrlInput.value = '';
  statusUrlInput.setCustomValidity('');
}

function toggleStatusEditMode() {
  state.statusEditMode = !state.statusEditMode;
  state.draggedStatusId = '';
  editStatusBtn.textContent = state.statusEditMode ? 'Done' : 'Edit';
  editStatusBtn.setAttribute('aria-pressed', String(state.statusEditMode));
  statusEditHint.hidden = !state.statusEditMode;
  clearStatusDropMarkers();
  renderStatusList();
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

