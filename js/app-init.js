// UI event listeners and application bootstrap
searchInput.addEventListener('input', renderBookmarks);
searchInput.addEventListener('keydown', handleSearchSubmit);

refreshBtn.addEventListener('click', () => {
  loadBookmarks();
});
if (refreshTabsBtn) {
  refreshTabsBtn.addEventListener('click', () => {
    loadTabs();
  });
}
if (tabsToggleBtn) {
  tabsToggleBtn.addEventListener('click', () => {
    state.tabsExpanded = !state.tabsExpanded;
    localStorage.setItem(STORAGE_KEYS.tabsExpanded, state.tabsExpanded ? '1' : '0');
    renderTabsList();
  });
}

toggleBtn.addEventListener('click', () => {
  state.expanded = !state.expanded;
  localStorage.setItem(STORAGE_KEYS.expanded, state.expanded ? '1' : '0');
  renderBookmarks();
});
if (bookmarkOrderLock) {
  bookmarkOrderLock.checked = state.bookmarkOrderLocked;
  bookmarkOrderLock.addEventListener('change', () => {
    state.bookmarkOrderLocked = bookmarkOrderLock.checked;
    localStorage.setItem(STORAGE_KEYS.bookmarkOrderLocked, state.bookmarkOrderLocked ? '1' : '0');
    state.draggedBookmarkKey = '';
    clearBookmarkDropMarkers();
    renderBookmarks();
  });
}
if (openStackModalBtn) {
  openStackModalBtn.addEventListener('click', () => openStackModal());
}
if (openStackEditMenuBtn) {
  openStackEditMenuBtn.addEventListener('click', toggleStackEditMenu);
}
if (closeStackModalBtn) {
  closeStackModalBtn.addEventListener('click', closeStackModal);
}
if (cancelStackBtn) {
  cancelStackBtn.addEventListener('click', closeStackModal);
}
if (createStackBtn) {
  createStackBtn.addEventListener('click', createStackFromDraft);
}
if (stackNameInput) {
  stackNameInput.addEventListener('input', renderStackModal);
  stackNameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !createStackBtn.disabled) {
      createStackFromDraft();
    }
  });
}
if (stackBookmarkSearch) {
  stackBookmarkSearch.addEventListener('input', renderStackModal);
}
if (stackModal) {
  stackModal.addEventListener('click', (event) => {
    if (event.target === stackModal) {
      closeStackModal();
    }
  });
}
document.addEventListener('click', (event) => {
  if (
    stackEditControl &&
    event.target instanceof Node &&
    !stackEditControl.contains(event.target)
  ) {
    closeStackEditMenu();
  }
});

addStatusBtn.addEventListener('click', addStatusSourceFromInputs);
statusUrlInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    addStatusSourceFromInputs();
  }
});
refreshStatusBtn.addEventListener('click', refreshOperationsSidebar);
if (openStatusModalBtn) {
  openStatusModalBtn.addEventListener('click', () => openStatusModal());
}
if (editStatusBtn) {
  editStatusBtn.addEventListener('click', toggleStatusEditMode);
}
if (closeStatusModalBtn) {
  closeStatusModalBtn.addEventListener('click', closeStatusModal);
}
if (cancelStatusModalBtn) {
  cancelStatusModalBtn.addEventListener('click', closeStatusModal);
}
if (statusModal) {
  statusModal.addEventListener('click', (event) => {
    if (event.target === statusModal) {
      closeStatusModal();
    }
  });
}
if (bookmarkMatchNewBtn) {
  bookmarkMatchNewBtn.addEventListener('click', () => {
    resolveBookmarkMatchChoice({ type: 'new' });
  });
}
if (bookmarkMatchCancelBtn) {
  bookmarkMatchCancelBtn.addEventListener('click', closeBookmarkMatchModal);
}
if (closeBookmarkMatchModalBtn) {
  closeBookmarkMatchModalBtn.addEventListener('click', closeBookmarkMatchModal);
}
if (bookmarkMatchModal) {
  bookmarkMatchModal.addEventListener('click', (event) => {
    if (event.target === bookmarkMatchModal) {
      closeBookmarkMatchModal();
    }
  });
}
if (themeSwitcher) {
  themeSwitcher.addEventListener('change', () => {
    applyTheme(themeSwitcher.value || 'lcars');
  });
}
if (calcModeBar) {
  calcModeBar.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (!target.classList.contains('calc-mode-btn')) {
      return;
    }
    const nextMode = target.dataset.mode || 'base64';
    state.calcMode = nextMode;
    updateCalcUi();
    runCalculator();
  });
}
if (calcDirectionBtn) {
  calcDirectionBtn.addEventListener('click', () => {
    if (!(state.calcMode === 'base64' || state.calcMode === 'url')) {
      return;
    }
    state.calcDirection = state.calcDirection === 'encode' ? 'decode' : 'encode';
    updateCalcUi();
    runCalculator();
  });
}
if (calcRunBtn) {
  calcRunBtn.addEventListener('click', runCalculator);
}
if (calcQuickBar && calcInput) {
  calcQuickBar.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (!target.classList.contains('calc-quick-btn')) {
      return;
    }
    const preset = target.dataset.preset || '';
    if (preset === 'json') {
      calcInput.value = '{\n  "env": "prod",\n  "service": "api-gateway",\n  "ok": true\n}';
    } else if (preset === 'jwt') {
      calcInput.value = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkRldiBVc2VyIiwiaWF0IjoxNTE2MjM5MDIyfQ.signature';
    } else if (preset === 'query') {
      calcInput.value = 'service=auth api&env=prod&redirect=https://example.com/callback?source=tab';
    } else if (preset === 'iso') {
      calcInput.value = new Date().toISOString();
    }
    runCalculator();
  });
}
if (calcSwapBtn && calcInput && calcOutput) {
  calcSwapBtn.addEventListener('click', () => {
    const nextInput = calcOutput.value;
    calcInput.value = nextInput;
    runCalculator();
  });
}
if (calcCopyBtn && calcOutput) {
  calcCopyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(calcOutput.value || '');
      calcCopyBtn.textContent = 'Copied';
      setTimeout(() => {
        calcCopyBtn.textContent = 'Copy';
      }, 900);
    } catch {
      calcOutput.focus();
      calcOutput.select();
      document.execCommand('copy');
      calcCopyBtn.textContent = 'Copied';
      setTimeout(() => {
        calcCopyBtn.textContent = 'Copy';
      }, 900);
    }
  });
}
if (calcInput) {
  calcInput.addEventListener('input', () => {
    runCalculator();
  });
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && stackEditMenu && !stackEditMenu.hidden) {
    closeStackEditMenu();
    openStackEditMenuBtn.focus();
    return;
  }
  if (event.key === 'Escape' && stackModal && !stackModal.hidden) {
    closeStackModal();
    return;
  }
  if (event.key === 'Escape' && statusModal && !statusModal.hidden) {
    closeStatusModal();
    return;
  }
  if (event.key === 'Escape' && bookmarkMatchModal && !bookmarkMatchModal.hidden) {
    closeBookmarkMatchModal();
  }
});

updateClock();
setInterval(updateClock, 1000);
applyTheme(state.theme);
setupMonitorShells();
setupBookmarkListeners();
updateCalcUi();
runCalculator();
state.statusSources = readStatusSources();
ensureWatchSourceSelection();
updateStatusRefreshMeta();
updateGitHubIncidentMeta();
setInterval(updateStatusRefreshMeta, 1000);
setInterval(updateGitHubIncidentMeta, 1000);
renderGitHubIncidentCard();
renderStatusList();
refreshOperationsSidebar();
setInterval(refreshOperationsSidebar, STATUS_REFRESH_MS);
setupTabListeners();
loadTabs();
setInterval(() => {
  if (state.tabs.length) {
    renderTabsList();
  }
}, 30000);
loadBookmarks();
initializePageTour();
