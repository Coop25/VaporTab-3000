// Bookmark loading, stacked bookmarks, duplicate matching, and launch flows
function flattenBookmarkTree(nodes, folderTrail = []) {
  const out = [];

  if (!Array.isArray(nodes)) {
    return out;
  }

  for (const node of nodes) {
    if (node?.title && isStackFolderTitle(node.title) && Array.isArray(node.children) && node.children.length) {
      const launchItems = collectBookmarkUrls(node.children);
      if (launchItems.length) {
        const cleanName = stripStackFolderPrefix(node.title);
        out.push({
          type: 'stack',
          folderId: node.id || '',
          parentId: node.parentId || '',
          name: cleanName,
          url: launchItems[launchItems.length - 1].url,
          folder: folderTrail[folderTrail.length - 1] || 'root',
          trail: folderTrail.join(' / ') || 'root',
          launchItems,
          stackCount: launchItems.length,
          searchText: launchItems.map((item) => `${item.name} ${item.url}`).join(' '),
          metricKey: `stack::${(folderTrail.join('/') || 'root').toLowerCase()}::${cleanName.toLowerCase()}`
        });
      }
      continue;
    }

    if (node.url) {
      out.push({
        type: 'bookmark',
        id: node.id || '',
        parentId: node.parentId || '',
        name: node.title || shortHost(node.url),
        url: node.url,
        folder: folderTrail[folderTrail.length - 1] || 'root',
        trail: folderTrail.join(' / ') || 'root'
      });
      continue;
    }

    if (node.children && node.children.length) {
      const nextTrail = node.title ? folderTrail.concat(node.title) : folderTrail;
      out.push(...flattenBookmarkTree(node.children, nextTrail));
    }
  }

  return out;
}

async function fetchBrowserBookmarks() {
  if (typeof chrome !== 'undefined' && chrome.bookmarks && chrome.bookmarks.getTree) {
    const tree = await new Promise((resolve, reject) => {
      chrome.bookmarks.getTree((result) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result);
        }
      });
    });

    return {
      items: flattenBookmarkTree(tree),
      source: 'chrome.bookmarks'
    };
  }

  if (typeof browser !== 'undefined' && browser.bookmarks && browser.bookmarks.getTree) {
    const tree = await browser.bookmarks.getTree();
    return {
      items: flattenBookmarkTree(tree),
      source: 'browser.bookmarks'
    };
  }

  throw new Error('No browser bookmarks API found in this context.');
}

async function loadBookmarks() {
  try {
    const result = await fetchBrowserBookmarks();
    state.allBookmarks = dedupeBookmarks(result.items);
    syncBookmarkOrder();
    state.sourceLabel = `Live bookmarks via ${result.source}`;
    setBookmarkNoticeMode('ok');
  } catch {
    state.allBookmarks = FALLBACK_BOOKMARKS.slice();
    syncBookmarkOrder();
    state.sourceLabel = 'Fallback sample bookmarks';
    const hasPermission = await hasBookmarksPermission();
    setBookmarkNoticeMode(hasPermission ? 'fallback-with-permission' : 'permission-needed');
  }

  sourceText.textContent = state.sourceLabel;
  renderAll();
}

function scheduleBookmarksReload() {
  if (state.bookmarkReloadTimer) {
    clearTimeout(state.bookmarkReloadTimer);
  }

  state.bookmarkReloadTimer = setTimeout(() => {
    state.bookmarkReloadTimer = null;
    loadBookmarks();
  }, 250);
}

function setupBookmarkListeners() {
  if (state.bookmarkListenersAttached) {
    return;
  }

  const bindListeners = (bookmarksApi) => {
    if (!bookmarksApi) {
      return false;
    }

    const events = [
      bookmarksApi.onCreated,
      bookmarksApi.onRemoved,
      bookmarksApi.onChanged,
      bookmarksApi.onMoved,
      bookmarksApi.onChildrenReordered,
      bookmarksApi.onImportBegan,
      bookmarksApi.onImportEnded
    ].filter(Boolean);

    for (const eventSource of events) {
      if (eventSource && typeof eventSource.addListener === 'function') {
        eventSource.addListener(scheduleBookmarksReload);
      }
    }

    return events.length > 0;
  };

  const attached =
    bindListeners(typeof chrome !== 'undefined' ? chrome.bookmarks : null) ||
    bindListeners(typeof browser !== 'undefined' ? browser.bookmarks : null);

  if (attached) {
    state.bookmarkListenersAttached = true;
  }
}

function dedupeBookmarks(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.metricKey || item.url;
    if (!key) {
      continue;
    }
    if (!map.has(key)) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}

function getBookmarkMetricKey(bookmark) {
  return bookmark?.metricKey || bookmark?.url || '';
}

function syncBookmarkOrder() {
  const availableKeys = state.allBookmarks.map(getBookmarkMetricKey).filter(Boolean);
  const availableSet = new Set(availableKeys);
  const nextOrder = state.bookmarkOrder.filter((key) => availableSet.has(key));
  const knownKeys = new Set(nextOrder);

  for (const key of availableKeys) {
    if (!knownKeys.has(key)) {
      nextOrder.push(key);
      knownKeys.add(key);
    }
  }

  if (
    nextOrder.length !== state.bookmarkOrder.length ||
    nextOrder.some((key, index) => key !== state.bookmarkOrder[index])
  ) {
    state.bookmarkOrder = nextOrder;
    saveBookmarkOrder();
  }
}

function moveBookmarkInSavedOrder(draggedKey, targetKey, placeAfter) {
  if (!state.bookmarkOrderLocked || !draggedKey || !targetKey || draggedKey === targetKey) {
    return;
  }

  syncBookmarkOrder();
  const nextOrder = state.bookmarkOrder.filter((key) => key !== draggedKey);
  const targetIndex = nextOrder.indexOf(targetKey);
  if (targetIndex < 0) {
    return;
  }

  nextOrder.splice(targetIndex + (placeAfter ? 1 : 0), 0, draggedKey);
  state.bookmarkOrder = nextOrder;
  saveBookmarkOrder();
  renderBookmarks();
}

function clearBookmarkDropMarkers() {
  for (const card of bookmarkGrid.querySelectorAll('.bookmark.is-dragging, .bookmark.drop-before, .bookmark.drop-after')) {
    card.classList.remove('is-dragging', 'drop-before', 'drop-after');
  }
}

function getStackCandidateBookmarks() {
  const candidatesByKey = new Map();
  for (const bookmark of state.allBookmarks.concat(state.stackEditSourceItems)) {
    if (bookmark.type === 'stack' || !bookmark.url) {
      continue;
    }
    candidatesByKey.set(getBookmarkMetricKey(bookmark), bookmark);
  }

  return Array.from(candidatesByKey.values())
    .sort((a, b) => {
      const folderDiff = String(a.trail || a.folder || '').localeCompare(String(b.trail || b.folder || ''));
      return folderDiff || a.name.localeCompare(b.name);
    });
}

function getStackDraftBookmarks() {
  const byKey = new Map(
    getStackCandidateBookmarks().map((bookmark) => [getBookmarkMetricKey(bookmark), bookmark])
  );
  for (const bookmark of state.stackEditSourceItems) {
    byKey.set(getBookmarkMetricKey(bookmark), bookmark);
  }
  return Array.from(state.stackDraft)
    .map((key) => byKey.get(key))
    .filter(Boolean);
}

function makeStackPickerCopy(bookmark) {
  const copy = document.createElement('span');
  copy.className = 'stack-picker-copy';

  const title = document.createElement('strong');
  title.textContent = bookmark.name;

  const meta = document.createElement('span');
  meta.textContent = `${bookmark.trail || bookmark.folder || 'root'} • ${shortHost(bookmark.url)}`;

  copy.appendChild(title);
  copy.appendChild(meta);
  return copy;
}

function renderStackModal() {
  if (!availableBookmarkList || !selectedBookmarkList || !createStackBtn) {
    return;
  }

  const candidates = getStackCandidateBookmarks();
  const selected = getStackDraftBookmarks();
  const selectedKeys = new Set(selected.map(getBookmarkMetricKey));
  const query = String(stackBookmarkSearch?.value || '').trim().toLowerCase();
  const available = candidates.filter((bookmark) => {
    if (!query) {
      return true;
    }
    return [bookmark.name, bookmark.url, bookmark.trail, bookmark.folder]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query);
  });

  availableBookmarkList.innerHTML = '';
  selectedBookmarkList.innerHTML = '';

  if (availableBookmarkCount) {
    availableBookmarkCount.textContent = `${available.length} shown`;
  }
  if (selectedBookmarkCount) {
    selectedBookmarkCount.textContent = `${selected.length} selected · last is front`;
  }

  if (!available.length) {
    const empty = document.createElement('p');
    empty.className = 'stack-picker-empty';
    empty.textContent = 'No bookmarks match this search.';
    availableBookmarkList.appendChild(empty);
  }

  for (const bookmark of available) {
    const key = getBookmarkMetricKey(bookmark);
    const isSelected = selectedKeys.has(key);
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'stack-picker-item stack-available-item';
    item.classList.toggle('is-selected', isSelected);
    item.disabled = isSelected;
    item.setAttribute('aria-label', isSelected ? `${bookmark.name} already added` : `Add ${bookmark.name} to stack`);
    item.appendChild(makeStackPickerCopy(bookmark));

    const action = document.createElement('span');
    action.className = 'stack-picker-action';
    action.textContent = isSelected ? 'ADDED' : 'ADD →';
    item.appendChild(action);
    item.addEventListener('click', () => {
      state.stackDraft.add(key);
      renderStackModal();
    });
    availableBookmarkList.appendChild(item);
  }

  if (!selected.length) {
    const empty = document.createElement('div');
    empty.className = 'stack-picker-empty stack-picker-empty-large';
    empty.innerHTML = '<strong>No bookmarks selected</strong><span>Add bookmarks from the left panel in launch order.</span>';
    selectedBookmarkList.appendChild(empty);
  }

  selected.forEach((bookmark, index) => {
    const key = getBookmarkMetricKey(bookmark);
    const isFrontDestination = index === selected.length - 1;
    const item = document.createElement('div');
    item.className = 'stack-picker-item stack-selected-item';
    item.classList.toggle('is-stack-front', isFrontDestination);
    item.draggable = true;
    item.tabIndex = 0;
    item.dataset.stackKey = key;
    item.title = isFrontDestination
      ? 'Front destination: replaces this new tab. Drag to reorder.'
      : 'Supporting tab. Drag to reorder.';
    item.setAttribute(
      'aria-label',
      `${bookmark.name}. ${isFrontDestination ? 'Front destination; replaces this new tab.' : 'Supporting tab.'} Drag to reorder, or use the arrow keys.`
    );

    const dragIndicator = document.createElement('span');
    dragIndicator.className = 'stack-drag-indicator';
    dragIndicator.setAttribute('aria-hidden', 'true');

    const order = document.createElement('span');
    order.className = 'stack-order';
    order.textContent = String(index + 1).padStart(2, '0');

    const copy = makeStackPickerCopy(bookmark);
    if (isFrontDestination) {
      const frontBadge = document.createElement('span');
      frontBadge.className = 'stack-front-badge';
      frontBadge.textContent = 'Front · Replaces this tab';
      copy.insertBefore(frontBadge, copy.lastElementChild);
    }
    const controls = document.createElement('span');
    controls.className = 'stack-item-controls';

    item.addEventListener('keydown', (event) => {
      if (event.target !== item) {
        return;
      }
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
        return;
      }
      event.preventDefault();
      moveStackDraft(key, event.key === 'ArrowUp' ? -1 : 1);
      requestAnimationFrame(() => {
        const nextItem = Array.from(selectedBookmarkList.querySelectorAll('.stack-selected-item'))
          .find((candidate) => candidate.dataset.stackKey === key);
        nextItem?.focus();
      });
    });
    item.addEventListener('dragstart', (event) => {
      if (!event.dataTransfer) {
        event.preventDefault();
        return;
      }
      state.draggedStackKey = key;
      item.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', key);
    });
    item.addEventListener('dragend', () => {
      state.draggedStackKey = '';
      clearStackDraftDropMarkers();
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'stack-remove-btn';
    removeBtn.textContent = 'REMOVE';
    removeBtn.setAttribute('aria-label', `Remove ${bookmark.name} from stack`);
    removeBtn.addEventListener('click', () => {
      state.stackDraft.delete(key);
      renderStackModal();
    });

    controls.appendChild(removeBtn);
    item.appendChild(dragIndicator);
    item.appendChild(order);
    item.appendChild(copy);
    item.appendChild(controls);

    item.addEventListener('dragover', (event) => {
      if (!state.draggedStackKey || state.draggedStackKey === key) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      const rect = item.getBoundingClientRect();
      const placeAfter = event.clientY >= rect.top + rect.height / 2;
      item.classList.toggle('drop-before', !placeAfter);
      item.classList.toggle('drop-after', placeAfter);
    });
    item.addEventListener('dragleave', () => {
      item.classList.remove('drop-before', 'drop-after');
    });
    item.addEventListener('drop', (event) => {
      event.preventDefault();
      const draggedKey = state.draggedStackKey || event.dataTransfer?.getData('text/plain') || '';
      const rect = item.getBoundingClientRect();
      const placeAfter = event.clientY >= rect.top + rect.height / 2;
      state.draggedStackKey = '';
      clearStackDraftDropMarkers();
      moveStackDraftBeside(draggedKey, key, placeAfter);
    });
    selectedBookmarkList.appendChild(item);
  });

  const hasName = Boolean(String(stackNameInput?.value || '').trim());
  createStackBtn.disabled = selected.length < 2 || !hasName || state.stackIsSaving;
  const isEditing = Boolean(state.editingStack);
  createStackBtn.textContent = state.stackIsSaving
    ? (isEditing ? 'Saving...' : 'Creating...')
    : (isEditing ? 'Save Stack' : 'Create Stack');

  if (stackModalMessage && !state.stackIsSaving) {
    const destination = selected[0]?.trail || selected[0]?.folder;
    stackModalMessage.textContent = selected.length < 2
      ? 'Add at least two bookmarks. The highlighted Front item replaces this tab.'
      : isEditing
        ? 'Ready to save. The highlighted Front item replaces this tab; the others open behind it.'
        : `Ready to create in ${destination || 'your bookmarks'}. The highlighted Front item replaces this tab.`;
  }
}

function moveStackDraft(key, direction) {
  const keys = Array.from(state.stackDraft);
  const index = keys.indexOf(key);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= keys.length) {
    return;
  }
  [keys[index], keys[nextIndex]] = [keys[nextIndex], keys[index]];
  state.stackDraft = new Set(keys);
  renderStackModal();
}

function moveStackDraftBeside(draggedKey, targetKey, placeAfter) {
  if (!draggedKey || !targetKey || draggedKey === targetKey) {
    return;
  }

  const keys = Array.from(state.stackDraft).filter((key) => key !== draggedKey);
  const targetIndex = keys.indexOf(targetKey);
  if (targetIndex < 0) {
    return;
  }

  keys.splice(targetIndex + (placeAfter ? 1 : 0), 0, draggedKey);
  state.stackDraft = new Set(keys);
  renderStackModal();
}

function clearStackDraftDropMarkers() {
  for (const item of selectedBookmarkList.querySelectorAll('.stack-selected-item.is-dragging, .stack-selected-item.drop-before, .stack-selected-item.drop-after')) {
    item.classList.remove('is-dragging', 'drop-before', 'drop-after');
  }
}

function openStackModal(stack = null) {
  if (!stackModal) {
    return;
  }

  state.editingStack = stack?.type === 'stack' ? stack : null;
  state.stackEditSourceItems = state.editingStack
    ? state.editingStack.launchItems.map((item) => ({
        type: 'bookmark',
        id: item.id || '',
        stackChildId: item.id || '',
        parentId: item.parentId || state.editingStack.folderId,
        name: item.name,
        url: item.url,
        folder: state.editingStack.name,
        trail: `${state.editingStack.trail || state.editingStack.folder || 'root'} / ${state.editingStack.name}`,
        metricKey: item.url
      }))
    : [];
  state.stackDraft = new Set(state.stackEditSourceItems.map(getBookmarkMetricKey));
  state.stackIsSaving = false;
  state.draggedStackKey = '';
  stackNameInput.value = state.editingStack?.name || '';
  stackBookmarkSearch.value = '';
  stackModalTitle.textContent = state.editingStack ? 'Edit Tab Stack' : 'Create Tab Stack';
  stackModal.hidden = false;
  renderStackModal();
  stackNameInput.focus();
}

function closeStackModal() {
  if (!stackModal) {
    return;
  }
  stackModal.hidden = true;
  state.stackDraft.clear();
  state.stackIsSaving = false;
  state.draggedStackKey = '';
  state.editingStack = null;
  state.stackEditSourceItems = [];
}

async function createBrowserBookmark(details) {
  if (typeof chrome !== 'undefined' && chrome.bookmarks && chrome.bookmarks.create) {
    return new Promise((resolve, reject) => {
      chrome.bookmarks.create(details, (result) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result);
        }
      });
    });
  }

  if (typeof browser !== 'undefined' && browser.bookmarks && browser.bookmarks.create) {
    return browser.bookmarks.create(details);
  }

  throw new Error('Bookmark creation is unavailable in this context.');
}

async function updateBrowserBookmark(id, changes) {
  if (typeof chrome !== 'undefined' && chrome.bookmarks && chrome.bookmarks.update) {
    return new Promise((resolve, reject) => {
      chrome.bookmarks.update(id, changes, (result) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result);
        }
      });
    });
  }

  if (typeof browser !== 'undefined' && browser.bookmarks && browser.bookmarks.update) {
    return browser.bookmarks.update(id, changes);
  }

  throw new Error('Bookmark editing is unavailable in this context.');
}

async function moveBrowserBookmark(id, destination) {
  if (typeof chrome !== 'undefined' && chrome.bookmarks && chrome.bookmarks.move) {
    return new Promise((resolve, reject) => {
      chrome.bookmarks.move(id, destination, (result) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result);
        }
      });
    });
  }

  if (typeof browser !== 'undefined' && browser.bookmarks && browser.bookmarks.move) {
    return browser.bookmarks.move(id, destination);
  }

  throw new Error('Bookmark reordering is unavailable in this context.');
}

async function removeBrowserBookmark(id) {
  if (typeof chrome !== 'undefined' && chrome.bookmarks && chrome.bookmarks.remove) {
    return new Promise((resolve, reject) => {
      chrome.bookmarks.remove(id, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  if (typeof browser !== 'undefined' && browser.bookmarks && browser.bookmarks.remove) {
    return browser.bookmarks.remove(id);
  }

  throw new Error('Bookmark removal is unavailable in this context.');
}

async function updateStackFromDraft(cleanName, selected) {
  const stack = state.editingStack;
  if (!stack?.folderId) {
    throw new Error('The original stack folder could not be found.');
  }

  await updateBrowserBookmark(stack.folderId, { title: `[stack] ${cleanName}` });

  const retainedIds = new Set(
    selected.map((bookmark) => bookmark.stackChildId).filter(Boolean)
  );
  for (const item of stack.launchItems) {
    if (item.id && !retainedIds.has(item.id)) {
      await removeBrowserBookmark(item.id);
    }
  }

  for (let index = 0; index < selected.length; index += 1) {
    const bookmark = selected[index];
    if (bookmark.stackChildId) {
      await updateBrowserBookmark(bookmark.stackChildId, {
        title: bookmark.name,
        url: bookmark.url
      });
      await moveBrowserBookmark(bookmark.stackChildId, {
        parentId: stack.folderId,
        index
      });
    } else {
      await createBrowserBookmark({
        parentId: stack.folderId,
        index,
        title: bookmark.name,
        url: bookmark.url
      });
    }
  }
}

async function createStackFromDraft() {
  if (state.stackIsSaving || state.stackDraft.size < 2) {
    return;
  }

  const selected = getStackDraftBookmarks();

  if (selected.length < 2) {
    renderStackModal();
    return;
  }

  const rawName = stackNameInput ? stackNameInput.value.trim() : '';
  const cleanName = rawName.replace(/^\s*\[stack\]\s*/i, '').trim();
  if (!cleanName) {
    stackModalMessage.textContent = 'Enter a name for this stack.';
    stackNameInput.focus();
    return;
  }
  state.stackIsSaving = true;
  if (stackModalMessage) {
    stackModalMessage.textContent = state.editingStack
      ? `Saving "${cleanName}"...`
      : `Creating "${cleanName}"...`;
  }
  renderStackModal();

  try {
    if (state.editingStack) {
      await updateStackFromDraft(cleanName, selected);
    } else {
      const folderDetails = { title: `[stack] ${cleanName}` };
      if (selected[0].parentId) {
        folderDetails.parentId = selected[0].parentId;
      }

      const folder = await createBrowserBookmark(folderDetails);
      for (const bookmark of selected) {
        await createBrowserBookmark({
          parentId: folder.id,
          title: bookmark.name,
          url: bookmark.url
        });
      }
    }

    const destination = selected[0].trail || selected[0].folder || 'bookmarks';
    const wasEditing = Boolean(state.editingStack);
    state.stackDraft.clear();
    state.stackIsSaving = false;
    state.editingStack = null;
    state.stackEditSourceItems = [];
    stackModal.hidden = true;
    await loadBookmarks();
    helperText.textContent = wasEditing
      ? `Updated "${cleanName}" with ${selected.length} bookmarks.`
      : `Created "${cleanName}" with ${selected.length} bookmarks in ${destination}.`;
  } catch (error) {
    state.stackIsSaving = false;
    renderStackModal();
    stackModalMessage.textContent = `Could not ${state.editingStack ? 'update' : 'create'} stack: ${String(error?.message || 'bookmark API unavailable')}`;
  }
}

function getTags() {
  const tags = new Set(['all']);
  for (const bookmark of state.allBookmarks) {
    tags.add((bookmark.folder || 'root').toLowerCase());
  }
  return Array.from(tags);
}

function renderTags() {
  const tags = getTags();
  tagBar.innerHTML = '';

  for (const tag of tags) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip' + (tag === state.activeTag ? ' active' : '');
    btn.textContent = tag;
    btn.addEventListener('click', () => {
      state.activeTag = tag;
      localStorage.setItem(STORAGE_KEYS.tag, tag);
      renderBookmarks();
      renderTags();
    });
    tagBar.appendChild(btn);
  }
}

function getEditableStacks() {
  return state.allBookmarks
    .filter((bookmark) => bookmark.type === 'stack' && bookmark.folderId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function closeStackEditMenu() {
  if (!stackEditMenu || !openStackEditMenuBtn) {
    return;
  }
  stackEditMenu.hidden = true;
  openStackEditMenuBtn.setAttribute('aria-expanded', 'false');
}

function renderStackEditMenu() {
  if (!stackEditMenu || !openStackEditMenuBtn) {
    return;
  }

  const stacks = getEditableStacks();
  openStackEditMenuBtn.disabled = stacks.length === 0;
  openStackEditMenuBtn.title = stacks.length
    ? 'Choose a stack to edit'
    : 'No stacks available to edit';
  stackEditMenu.innerHTML = '';

  if (!stacks.length) {
    closeStackEditMenu();
    return;
  }

  for (const stack of stacks) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'stack-edit-menu-item';
    item.setAttribute('role', 'menuitem');

    const name = document.createElement('strong');
    name.textContent = stack.name;
    const count = document.createElement('span');
    count.textContent = `${stack.stackCount} bookmark${stack.stackCount === 1 ? '' : 's'}`;

    item.appendChild(name);
    item.appendChild(count);
    item.addEventListener('click', () => {
      closeStackEditMenu();
      openStackModal(stack);
    });
    stackEditMenu.appendChild(item);
  }
}

function toggleStackEditMenu() {
  if (!stackEditMenu || !openStackEditMenuBtn || openStackEditMenuBtn.disabled) {
    return;
  }

  const willOpen = stackEditMenu.hidden;
  if (willOpen) {
    renderStackEditMenu();
  }
  stackEditMenu.hidden = !willOpen;
  openStackEditMenuBtn.setAttribute('aria-expanded', String(willOpen));
  if (willOpen) {
    stackEditMenu.querySelector('.stack-edit-menu-item')?.focus();
  }
}

function filteredBookmarks() {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = state.allBookmarks
    .filter((bookmark) => {
      const folder = (bookmark.folder || 'root').toLowerCase();
      return state.activeTag === 'all' || folder === state.activeTag;
    })
    .filter((bookmark) => {
      if (!query) {
        return true;
      }

      const haystack = [bookmark.name, bookmark.url, bookmark.folder, bookmark.trail, bookmark.searchText]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });

  if (state.bookmarkOrderLocked) {
    const orderByKey = new Map(state.bookmarkOrder.map((key, index) => [key, index]));
    return filtered.sort((a, b) => {
      const aIndex = orderByKey.get(getBookmarkMetricKey(a)) ?? Number.MAX_SAFE_INTEGER;
      const bIndex = orderByKey.get(getBookmarkMetricKey(b)) ?? Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    });
  }

  return filtered.sort((a, b) => {
    const clickDiff = getBookmarkClicks(getBookmarkMetricKey(b)) - getBookmarkClicks(getBookmarkMetricKey(a));
    if (clickDiff !== 0) {
      return clickDiff;
    }
    return a.name.localeCompare(b.name);
  });
}

function renderBookmarks() {
  renderStackEditMenu();
  if (bookmarkOrderLock) {
    bookmarkOrderLock.checked = state.bookmarkOrderLocked;
  }
  if (bookmarkOrderHint) {
    bookmarkOrderHint.textContent = state.bookmarkOrderLocked
      ? 'Drag to arrange'
      : 'Most used first';
  }

  const items = filteredBookmarks();
  const visibleItems = state.expanded ? items : items.slice(0, VISIBLE_COLLAPSED);
  const maxClicks = items.reduce((max, bookmark) => {
    return Math.max(max, getBookmarkClicks(getBookmarkMetricKey(bookmark)));
  }, 0);
  const usageLeaders = items
    .map((bookmark) => ({ key: getBookmarkMetricKey(bookmark), clicks: getBookmarkClicks(getBookmarkMetricKey(bookmark)) }))
    .filter((entry) => entry.clicks > 0)
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 5);
  const rankByUrl = new Map(usageLeaders.map((entry, index) => [entry.key, index + 1]));
  bookmarkGrid.innerHTML = '';

  bookmarkCount.textContent = `${items.length} shown`;

  if (!items.length) {
    bookmarkGrid.innerHTML = '<p class="empty">No bookmarks match this search or folder filter.</p>';
    toggleBtn.hidden = true;
    return;
  }

  for (const bookmark of visibleItems) {
    const card = document.createElement('div');
    card.className = 'bookmark-card';

    const link = document.createElement('a');
    link.className = 'bookmark';
    link.href = bookmark.url;
    link.rel = 'noreferrer';
    link.draggable = state.bookmarkOrderLocked;
    if (bookmark.type === 'stack') {
      link.classList.add('bookmark-stack');
      link.title = `Open ${bookmark.stackCount} bookmarks`;
    }
    const metricKey = getBookmarkMetricKey(bookmark);
    link.dataset.bookmarkKey = metricKey;

    const head = document.createElement('div');
    head.className = 'bookmark-head';

    const favicon = document.createElement('img');
    favicon.className = 'bookmark-favicon';

    const fallback = document.createElement('span');
    fallback.className = 'bookmark-fallback';
    fallback.textContent = getMonogram(bookmark);
    setupCachedIcon(favicon, fallback, getFaviconUrls(bookmark.url));

    const title = document.createElement('p');
    title.className = 'bookmark-title';
    title.textContent = bookmark.name;

    const clickCount = getBookmarkClicks(getBookmarkMetricKey(bookmark));
    const heatProgress = getHeatProgress(clickCount, maxClicks);
    const heatTier = getHeatTier(clickCount, maxClicks);
    if (heatTier > 0) {
      link.classList.add(`heat-${heatTier}`);
    }
    const usageRank = rankByUrl.get(getBookmarkMetricKey(bookmark));
    if (usageRank) {
      link.classList.add(`top-rank-${usageRank}`);
    }

    const heat = document.createElement('span');
    heat.className = 'bookmark-heat';

    const heatTrack = document.createElement('span');
    heatTrack.className = 'bookmark-heat-track';
    const heatFill = document.createElement('span');
    heatFill.className = 'bookmark-heat-fill';
    heatFill.style.width = `${heatProgress}%`;
    heatTrack.appendChild(heatFill);

    const heatCount = document.createElement('span');
    heatCount.className = 'bookmark-heat-count';
    heatCount.textContent = clickCount.toLocaleString();

    heat.appendChild(heatTrack);
    heat.appendChild(heatCount);

    head.appendChild(favicon);
    head.appendChild(fallback);
    head.appendChild(title);

    const url = document.createElement('p');
    url.className = 'bookmark-url';
    url.textContent = bookmark.type === 'stack'
      ? `${bookmark.stackCount} sites -> ${shortHost(bookmark.url)}`
      : shortHost(bookmark.url);

    const folder = document.createElement('p');
    folder.className = 'bookmark-folder';
    folder.textContent = bookmark.type === 'stack'
      ? `${bookmark.trail || bookmark.folder || 'root'} / stack`
      : bookmark.trail || bookmark.folder || 'root';

    const foot = document.createElement('div');
    foot.className = 'bookmark-foot';
    if (bookmark.type === 'stack') {
      const stackBadge = document.createElement('span');
      stackBadge.className = 'bookmark-stack-badge';
      stackBadge.textContent = `STACK x${bookmark.stackCount}`;
      foot.appendChild(stackBadge);
    }
    foot.appendChild(heat);

    link.appendChild(head);
    link.appendChild(url);
    link.appendChild(folder);
    link.appendChild(foot);

    link.addEventListener('click', async (event) => {
      event.preventDefault();
      if (Date.now() < state.suppressBookmarkClickUntil) {
        return;
      }
      state.clicks[metricKey] = getBookmarkClicks(metricKey) + 1;
      saveClicks();
      renderBookmarks();
      if (bookmark.type === 'stack') {
        await launchStackBookmark(bookmark);
        return;
      }
      await openBookmarkTarget(bookmark.url);
    });

    link.addEventListener('dragstart', (event) => {
      if (!state.bookmarkOrderLocked || !event.dataTransfer) {
        event.preventDefault();
        return;
      }
      state.draggedBookmarkKey = metricKey;
      link.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', metricKey);
    });

    link.addEventListener('dragover', (event) => {
      if (!state.bookmarkOrderLocked || !state.draggedBookmarkKey || state.draggedBookmarkKey === metricKey) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      const rect = link.getBoundingClientRect();
      const placeAfter = event.clientX >= rect.left + rect.width / 2;
      link.classList.toggle('drop-before', !placeAfter);
      link.classList.toggle('drop-after', placeAfter);
    });

    link.addEventListener('dragleave', () => {
      link.classList.remove('drop-before', 'drop-after');
    });

    link.addEventListener('drop', (event) => {
      if (!state.bookmarkOrderLocked) {
        return;
      }
      event.preventDefault();
      const draggedKey = state.draggedBookmarkKey || event.dataTransfer?.getData('text/plain') || '';
      const rect = link.getBoundingClientRect();
      const placeAfter = event.clientX >= rect.left + rect.width / 2;
      state.suppressBookmarkClickUntil = Date.now() + 250;
      state.draggedBookmarkKey = '';
      clearBookmarkDropMarkers();
      moveBookmarkInSavedOrder(draggedKey, metricKey, placeAfter);
    });

    link.addEventListener('dragend', () => {
      state.suppressBookmarkClickUntil = Date.now() + 250;
      state.draggedBookmarkKey = '';
      clearBookmarkDropMarkers();
    });
    card.appendChild(link);
    bookmarkGrid.appendChild(card);
  }

  if (items.length > VISIBLE_COLLAPSED) {
    toggleBtn.hidden = false;
    toggleBtn.textContent = state.expanded ? 'Show fewer' : `Show all (${items.length})`;
  } else {
    toggleBtn.hidden = true;
  }
}

function handleSearchSubmit(event) {
  if (event.key !== 'Enter') {
    return;
  }

  const value = searchInput.value.trim();
  if (!value) {
    return;
  }

  const resolvedUrl = resolveAddressInput(value);
  if (resolvedUrl) {
    navigateCurrentTab(resolvedUrl);
    return;
  }

  const q = new URL('https://duckduckgo.com/');
  q.searchParams.set('q', value);
  navigateCurrentTab(q.toString());
}

function resolveAddressInput(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) {
    return '';
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    try {
      return new URL(value).toString();
    } catch {
      return value;
    }
  }

  if (/\s/.test(value)) {
    return '';
  }

  const hostLike =
    /^(localhost|\d{1,3}(\.\d{1,3}){3}|(\[[a-f0-9:]+\])|[\w-]+(\.[\w-]+)+)(:\d+)?([/?#].*)?$/i.test(value);

  if (!hostLike) {
    return '';
  }

  const prefersHttp = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[a-f0-9:]+\])/i.test(value);
  const candidate = `${prefersHttp ? 'http' : 'https'}://${value}`;

  try {
    return new URL(candidate).toString();
  } catch {
    return '';
  }
}

function navigateCurrentTab(url) {
  const tabsApi = getTabsApi();

  if (tabsApi && tabsApi.getCurrent && tabsApi.update) {
    if (typeof chrome !== 'undefined') {
      chrome.tabs.getCurrent((currentTab) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          window.location.href = url;
          return;
        }

        if (currentTab && Number.isInteger(currentTab.id)) {
          chrome.tabs.update(currentTab.id, { url });
          return;
        }

        window.location.href = url;
      });
      return;
    }

    if (typeof browser !== 'undefined') {
      browser.tabs.getCurrent()
        .then((currentTab) => {
          if (currentTab && Number.isInteger(currentTab.id)) {
            return browser.tabs.update(currentTab.id, { url });
          }
          window.location.href = url;
          return null;
        })
        .catch(() => {
          window.location.href = url;
        });
      return;
    }
  }

  window.location.href = url;
}

async function openNewTab(url, active = false, options = {}) {
  const tabsApi = getTabsApi();
  if (!tabsApi || !tabsApi.create) {
    window.open(url, active ? '_blank' : '_blank', 'noopener,noreferrer');
    return null;
  }

  const createOptions = { url, active };
  if (Number.isInteger(options.index)) {
    createOptions.index = options.index;
  }
  if (Number.isInteger(options.windowId)) {
    createOptions.windowId = options.windowId;
  }
  if (Number.isInteger(options.openerTabId)) {
    createOptions.openerTabId = options.openerTabId;
  }

  if (typeof chrome !== 'undefined') {
    return new Promise((resolve) => {
      tabsApi.create(createOptions, (tab) => {
        resolve(tab || null);
      });
    });
  }

  if (typeof browser !== 'undefined') {
    return tabsApi.create(createOptions).catch(() => {
      window.open(url, active ? '_blank' : '_blank', 'noopener,noreferrer');
      return null;
    });
  }

  window.open(url, active ? '_blank' : '_blank', 'noopener,noreferrer');
  return null;
}

async function openBookmarkTarget(url, options = {}) {
  const allowReuse = options.allowReuse !== false;
  if (allowReuse) {
    const reuseResult = await maybeReuseOpenBookmarkTab(url, options).catch(() => false);
    if (reuseResult) {
      return;
    }
  }

  navigateCurrentTab(url);
}

async function launchStackBookmark(bookmark) {
  try {
    const launchItems = Array.isArray(bookmark?.launchItems) ? bookmark.launchItems.filter((item) => item?.url) : [];
    const baselineTabs = await queryTabs({}).catch(() => []);
    const anchor = await getCurrentTabInfo().catch(() => null);
    let placedCount = 0;
    logStackTabDebug('launch-start', {
      bookmark: bookmark?.name || '',
      launchItems: launchItems.map((item) => item.url),
      anchor,
      baselineTabs: baselineTabs.map((tab) => ({
        id: Number(tab?.id) || 0,
        windowId: Number(tab?.windowId) || 0,
        index: Number.isInteger(tab?.index) ? tab.index : null,
        active: Boolean(tab?.active),
        url: String(tab?.url || tab?.pendingUrl || '')
      }))
    });
    if (!launchItems.length) {
      if (bookmark?.url) {
        await openBookmarkTarget(bookmark.url, { candidateTabs: baselineTabs });
      }
      return;
    }

    for (let index = 0; index < launchItems.length - 1; index += 1) {
      logStackTabDebug('launch-step-start', {
        step: index,
        url: launchItems[index].url,
        placedCount
      });

      const reuseResult = await maybeReuseOpenBookmarkTab(launchItems[index].url, {
        candidateTabs: baselineTabs,
        existingAction: 'keep',
        targetIndex: anchor ? anchor.index + 1 + placedCount : undefined
      }).catch((error) => {
        logStackTabDebug('reuse-check-error', {
          step: index,
          url: launchItems[index].url,
          error: error && error.message ? error.message : String(error)
        });
        return false;
      });

      if (!reuseResult) {
        const targetIndex = anchor ? anchor.index + 1 + placedCount : null;
        const createdTab = await openNewTab(launchItems[index].url, false, {
          windowId: anchor?.windowId
        });
        logStackTabDebug('create-result', {
          step: index,
          url: launchItems[index].url,
          targetIndex,
          createdTab: createdTab
            ? {
                id: Number(createdTab.id) || 0,
                windowId: Number(createdTab.windowId) || 0,
                index: Number.isInteger(createdTab.index) ? createdTab.index : null,
                active: Boolean(createdTab.active),
                openerTabId: Number(createdTab.openerTabId) || 0,
                url: String(createdTab.url || createdTab.pendingUrl || '')
              }
            : null
        });

        if (createdTab && Number.isInteger(createdTab.id) && anchor && targetIndex !== null) {
          const beforeTabs = await queryTabs({ windowId: anchor.windowId }).catch(() => []);
          const beforeTab = (Array.isArray(beforeTabs) ? beforeTabs : []).find((tab) => Number(tab?.id) === createdTab.id) || null;
          logStackTabDebug('move-before', {
            tabId: createdTab.id,
            targetIndex,
            anchor,
            beforeTab: beforeTab
              ? {
                  id: Number(beforeTab.id) || 0,
                  windowId: Number(beforeTab.windowId) || 0,
                  index: Number.isInteger(beforeTab.index) ? beforeTab.index : null,
                  active: Boolean(beforeTab.active),
                  url: String(beforeTab.url || beforeTab.pendingUrl || '')
                }
              : null,
            windowTabs: (Array.isArray(beforeTabs) ? beforeTabs : []).map((tab) => ({
              id: Number(tab?.id) || 0,
              index: Number.isInteger(tab?.index) ? tab.index : null,
              active: Boolean(tab?.active),
              url: String(tab?.url || tab?.pendingUrl || '')
            }))
          });

          const movedTab = await moveBrowserTab(createdTab.id, targetIndex, anchor.windowId);
          const afterTabs = await queryTabs({ windowId: anchor.windowId }).catch(() => []);
          const afterTab = (Array.isArray(afterTabs) ? afterTabs : []).find((tab) => Number(tab?.id) === createdTab.id) || null;
          logStackTabDebug('move-after', {
            tabId: createdTab.id,
            targetIndex,
            movedTab: movedTab
              ? {
                  id: Number(movedTab.id) || 0,
                  windowId: Number(movedTab.windowId) || 0,
                  index: Number.isInteger(movedTab.index) ? movedTab.index : null,
                  active: Boolean(movedTab.active),
                  url: String(movedTab.url || movedTab.pendingUrl || '')
                }
              : null,
            afterTab: afterTab
              ? {
                  id: Number(afterTab.id) || 0,
                  windowId: Number(afterTab.windowId) || 0,
                  index: Number.isInteger(afterTab.index) ? afterTab.index : null,
                  active: Boolean(afterTab.active),
                  url: String(afterTab.url || afterTab.pendingUrl || '')
                }
              : null,
            windowTabs: (Array.isArray(afterTabs) ? afterTabs : []).map((tab) => ({
              id: Number(tab?.id) || 0,
              index: Number.isInteger(tab?.index) ? tab.index : null,
              active: Boolean(tab?.active),
              url: String(tab?.url || tab?.pendingUrl || '')
            }))
          });
        }

        if (createdTab && Number.isInteger(createdTab.id)) {
          placedCount += 1;
        }
      } else {
        logStackTabDebug('reuse-existing', {
          step: index,
          url: launchItems[index].url,
          reuseResult
        });
        if (reuseResult.reusedExisting) {
          placedCount += 1;
        }
        if (reuseResult.cancelled) {
          return;
        }
      }
    }

    logStackTabDebug('launch-final-target', {
      url: launchItems[launchItems.length - 1].url
    });
    await openBookmarkTarget(launchItems[launchItems.length - 1].url, {
      candidateTabs: baselineTabs,
      existingAction: 'activate'
    });
  } catch (error) {
    logStackTabDebug('launch-error', {
      bookmark: bookmark?.name || '',
      error: error && error.message ? error.message : String(error)
    });
    throw error;
  }
}

function renderAll() {
  renderTags();
  renderBookmarks();
}
