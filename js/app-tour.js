// First-run and on-demand guided page tour
const TOUR_STEPS = [
  {
    title: 'Welcome to VaporTab',
    copy: 'This quick tour shows you where everything lives. Use Next and Back, the arrow keys, or press Escape to leave at any time.'
  },
  {
    target: '#commandPaletteLauncher',
    title: 'Command palette',
    copy: 'Open Commands or press Ctrl+K to search bookmarks, switch tabs and themes, jump to tools, refresh data, and run page actions without hunting through the interface.'
  },
  {
    target: '.tower-head',
    title: 'Operations sidebar',
    copy: 'The sidebar keeps your clock, bookmark source, theme controls, selected service incident streak, and status monitor together.'
  },
  {
    target: '#sourceText',
    title: 'Bookmark source',
    copy: 'This tells you whether VaporTab is reading live browser bookmarks or showing its fallback set. The Support VaporTab link below lets you leave the creator a tip if you enjoy the extension.'
  },
  {
    target: '#themeSwitcher',
    title: 'Choose a theme',
    copy: 'Use this dropdown to switch instantly between LCARS, Synthwave, Dark Mode, Terminal UI, and Old PC Dark. Your selection is remembered for future new tabs.'
  },
  {
    target: '.github-incident-block',
    title: 'Service Watch',
    copy: 'GitHub is the default, but this card can follow any NET OPS source. In NET OPS edit mode, select Watch on the service whose condition, latest incident, and uninterrupted-day streak you want shown here.'
  },
  {
    target: '.status-sidebar-block',
    title: 'NET OPS',
    copy: 'Monitor status pages here. Refresh checks now and Add registers another service. In Edit mode, dotted grips mark draggable source cards: drag the whole card to reorder it. Edit, Watch, and Remove stay together along the bottom.'
  },
  {
    target: '.bookmark-terminal .monitor-header',
    title: 'Collapsible panels',
    copy: 'Select any panel header to collapse or expand it. The page remembers the layout you leave behind.'
  },
  {
    target: '.bookmark-terminal .input-row',
    title: 'Search and launch',
    copy: 'Search your bookmarks by name or URL. If there is no match, pressing Enter runs a web search, while Reload refreshes the bookmark library.'
  },
  {
    target: '#openStackModalBtn',
    title: 'Create a stack',
    copy: 'Create Stack opens the editor. The next few steps use a safe preview window, so nothing in your real bookmarks will be changed.'
  },
  {
    target: '#tourStackDemoPicker',
    stackDemoMode: 'create',
    title: 'Choose stack bookmarks',
    copy: 'Search or browse your bookmarks on the left, then use Add to place them in the Current Stack on the right. At least two bookmarks are required.'
  },
  {
    target: '#tourStackDemoSelected',
    stackDemoMode: 'create',
    title: 'Set the launch order',
    copy: 'The right panel is the launch order. Dots on the left mark draggable entries, and the highlighted Front badge shows which destination replaces this new tab. Drag the whole entry to reorder it; earlier entries open as supporting tabs.'
  },
  {
    target: '#openStackEditMenuBtn',
    title: 'Choose a stack to edit',
    copy: 'Edit Stack opens a compact list of your saved stacks. Select one to continue. The control is disabled when there are no stacks in your browser bookmarks.'
  },
  {
    target: '#tourStackDemoName',
    stackDemoMode: 'edit',
    title: 'Edit an existing stack',
    copy: 'Use Edit Stack at the top-right of the bookmark toolbar, then choose a stack from its menu. This editor opens prefilled so you can rename the stack and add, remove, or reorder its bookmarks.'
  },
  {
    target: '#tourStackBrowserModel',
    stackDemoMode: 'edit',
    title: 'Saved as browser bookmarks',
    copy: 'A stack is a normal browser bookmark folder whose name starts with [stack]. Its child bookmarks are stored in launch order, so stacks sync and travel like your other browser bookmarks.'
  },
  {
    target: '#tourStackDemoSave',
    stackDemoMode: 'edit',
    title: 'Create or save',
    copy: 'Create Stack makes the folder and copies the chosen bookmarks into it. Save Stack updates that folder. Removing a stack entry removes only its copy inside the stack; your original standalone bookmark remains untouched.'
  },
  {
    target: '.bookmark-filter-row',
    title: 'Folders and ordering',
    copy: 'Folder chips filter the library. Keep Fixed order enabled to drag bookmark cards into a custom order, or disable it to rank them by usage.'
  },
  {
    target: '#bookmarkGrid',
    title: 'Bookmark cards',
    copy: 'Select a card to open it. If that bookmark is already open, VaporTab asks whether to reuse the existing tab or open a new instance. Cards track local click activity, while stack cards open several related bookmarks together.'
  },
  {
    target: '.tabs-terminal',
    title: 'Active workspaces',
    copy: 'This panel lists open tabs across browser windows. Select a tab to jump to it, or use its close control to clean it up.'
  },
  {
    target: '.devtools-terminal',
    title: 'Engineering utility',
    copy: 'Encode and decode Base64 or URLs, calculate SHA-256 hashes, and convert Unix timestamps. Presets and copy/swap controls speed up common tasks.'
  },
  {
    target: '#tourLauncher',
    title: 'Tour anytime',
    copy: "That's the page. Use the Tour button whenever you want to replay this walkthrough."
  }
];

const tourLauncher = document.getElementById('tourLauncher');
const tourLayer = document.getElementById('tourLayer');
const tourSpotlight = document.getElementById('tourSpotlight');
const tourCard = document.getElementById('tourCard');
const tourProgress = document.getElementById('tourProgress');
const tourTitle = document.getElementById('tourTitle');
const tourCopy = document.getElementById('tourCopy');
const tourBackBtn = document.getElementById('tourBackBtn');
const tourNextBtn = document.getElementById('tourNextBtn');
const tourCloseBtn = document.getElementById('tourCloseBtn');
const tourStackDemo = document.getElementById('tourStackDemo');
const tourStackDemoTitle = document.getElementById('tourStackDemoTitle');
const tourStackDemoKicker = document.getElementById('tourStackDemoKicker');
const tourStackDemoMessage = document.getElementById('tourStackDemoMessage');
const tourStackDemoSave = document.getElementById('tourStackDemoSave');

let tourIndex = 0;
let tourActive = false;
let tourPreviousFocus = null;
let tourShellStates = [];
let tourPositionFrame = 0;

function setTourShellExpanded(shell, expanded) {
  const header = shell?.querySelector('.monitor-header');
  if (!(shell instanceof HTMLElement) || !(header instanceof HTMLElement)) {
    return;
  }

  shell.classList.toggle('is-collapsed', !expanded);
  header.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  header.setAttribute('title', expanded ? 'Collapse panel' : 'Expand panel');
}

function restoreTourShells() {
  for (const entry of tourShellStates) {
    setTourShellExpanded(entry.shell, !entry.wasCollapsed);
  }
  tourShellStates = [];
}

function getTourTarget() {
  const selector = TOUR_STEPS[tourIndex]?.target;
  if (!selector) {
    return null;
  }
  return document.querySelector(selector);
}

function setTourStackDemoMode(mode = '') {
  const visible = mode === 'create' || mode === 'edit';
  tourStackDemo.hidden = !visible;
  if (!visible) {
    return;
  }

  const isEditing = mode === 'edit';
  tourStackDemo.classList.toggle('is-edit-preview', isEditing);
  tourStackDemoTitle.textContent = isEditing ? 'Edit Tab Stack' : 'Create Tab Stack';
  tourStackDemoKicker.textContent = isEditing
    ? 'TOUR PREVIEW // EXISTING STACK'
    : 'TOUR PREVIEW // NEW STACK';
  tourStackDemoMessage.textContent = isEditing
    ? 'Preview only. Save Stack would update the existing browser bookmark folder.'
    : 'Preview only. Create Stack would add a new browser bookmark folder.';
  tourStackDemoSave.textContent = isEditing ? 'Save Stack' : 'Create Stack';
}

function positionTourElements() {
  if (!tourActive || tourLayer.hidden) {
    return;
  }

  const target = getTourTarget();
  const viewportPadding = 14;
  const targetPadding = 7;
  const cardGap = 14;

  tourLayer.classList.toggle('has-target', Boolean(target));
  tourSpotlight.hidden = !target;

  if (!target) {
    tourCard.style.left = `${Math.max(viewportPadding, (window.innerWidth - tourCard.offsetWidth) / 2)}px`;
    tourCard.style.top = `${Math.max(viewportPadding, (window.innerHeight - tourCard.offsetHeight) / 2)}px`;
    return;
  }

  const rect = target.getBoundingClientRect();
  const spotLeft = Math.max(4, rect.left - targetPadding);
  const spotTop = Math.max(4, rect.top - targetPadding);
  const spotRight = Math.min(window.innerWidth - 4, rect.right + targetPadding);
  const spotBottom = Math.min(window.innerHeight - 4, rect.bottom + targetPadding);

  tourSpotlight.style.left = `${spotLeft}px`;
  tourSpotlight.style.top = `${spotTop}px`;
  tourSpotlight.style.width = `${Math.max(0, spotRight - spotLeft)}px`;
  tourSpotlight.style.height = `${Math.max(0, spotBottom - spotTop)}px`;

  const cardWidth = tourCard.offsetWidth;
  const cardHeight = tourCard.offsetHeight;
  const spaces = {
    bottom: window.innerHeight - spotBottom,
    top: spotTop,
    right: window.innerWidth - spotRight,
    left: spotLeft
  };

  let left = Math.min(
    window.innerWidth - cardWidth - viewportPadding,
    Math.max(viewportPadding, spotLeft + (spotRight - spotLeft - cardWidth) / 2)
  );
  let top;

  if (spaces.bottom >= cardHeight + cardGap || spaces.bottom >= spaces.top) {
    top = spotBottom + cardGap;
  } else {
    top = spotTop - cardHeight - cardGap;
  }

  if (top < viewportPadding || top + cardHeight > window.innerHeight - viewportPadding) {
    top = Math.min(
      window.innerHeight - cardHeight - viewportPadding,
      Math.max(viewportPadding, spotTop + (spotBottom - spotTop - cardHeight) / 2)
    );
    if (spaces.right >= cardWidth + cardGap) {
      left = spotRight + cardGap;
    } else if (spaces.left >= cardWidth + cardGap) {
      left = spotLeft - cardWidth - cardGap;
    }
  }

  tourCard.style.left = `${Math.max(viewportPadding, left)}px`;
  tourCard.style.top = `${Math.max(viewportPadding, top)}px`;
}

function queueTourPosition() {
  cancelAnimationFrame(tourPositionFrame);
  tourPositionFrame = requestAnimationFrame(positionTourElements);
}

function showTourStep(index) {
  tourIndex = Math.min(TOUR_STEPS.length - 1, Math.max(0, index));
  const step = TOUR_STEPS[tourIndex];
  setTourStackDemoMode(step.stackDemoMode || '');
  const target = getTourTarget();
  const targetShell = target?.closest('.monitor-shell');

  if (targetShell?.classList.contains('is-collapsed') && !target?.classList.contains('monitor-header')) {
    setTourShellExpanded(targetShell, true);
  }

  tourProgress.textContent = `${tourIndex + 1} / ${TOUR_STEPS.length}`;
  tourTitle.textContent = step.title;
  tourCopy.textContent = step.copy;
  tourBackBtn.disabled = tourIndex === 0;
  tourNextBtn.textContent = tourIndex === TOUR_STEPS.length - 1 ? 'Finish' : 'Next';

  target?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
  queueTourPosition();
  setTimeout(queueTourPosition, 80);
}

function startPageTour() {
  if (tourActive) {
    return;
  }

  tourActive = true;
  tourPreviousFocus = document.activeElement;
  tourShellStates = monitorShells.map((shell) => ({
    shell,
    wasCollapsed: shell.classList.contains('is-collapsed')
  }));
  document.body.classList.add('tour-active');
  tourLayer.hidden = false;
  showTourStep(0);
  tourNextBtn.focus();
}

function finishPageTour() {
  if (!tourActive) {
    return;
  }

  tourActive = false;
  writePersistentStorage(STORAGE_KEYS.tourCompleted, '1');
  cancelAnimationFrame(tourPositionFrame);
  restoreTourShells();
  setTourStackDemoMode('');
  document.body.classList.remove('tour-active');
  tourLayer.classList.remove('has-target');
  tourLayer.hidden = true;

  if (tourPreviousFocus instanceof HTMLElement && tourPreviousFocus !== document.body) {
    tourPreviousFocus.focus();
  } else {
    tourLauncher.focus();
  }
}

function handleTourKeydown(event) {
  if (!tourActive) {
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    finishPageTour();
    return;
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    if (tourIndex === TOUR_STEPS.length - 1) {
      finishPageTour();
    } else {
      showTourStep(tourIndex + 1);
    }
    return;
  }
  if (event.key === 'ArrowLeft' && tourIndex > 0) {
    event.preventDefault();
    showTourStep(tourIndex - 1);
    return;
  }
  if (event.key !== 'Tab') {
    return;
  }

  const focusable = [tourCloseBtn, tourBackBtn, tourNextBtn].filter((button) => !button.disabled);
  const currentIndex = focusable.indexOf(document.activeElement);
  const nextIndex = event.shiftKey
    ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
    : (currentIndex >= focusable.length - 1 ? 0 : currentIndex + 1);
  event.preventDefault();
  focusable[nextIndex].focus();
}

function initializePageTour() {
  tourLauncher.addEventListener('click', startPageTour);
  tourCloseBtn.addEventListener('click', finishPageTour);
  tourBackBtn.addEventListener('click', () => showTourStep(tourIndex - 1));
  tourNextBtn.addEventListener('click', () => {
    if (tourIndex === TOUR_STEPS.length - 1) {
      finishPageTour();
      return;
    }
    showTourStep(tourIndex + 1);
  });
  window.addEventListener('resize', queueTourPosition);
  document.addEventListener('scroll', queueTourPosition, true);
  document.addEventListener('keydown', handleTourKeydown);

  if (readPersistentStorage(STORAGE_KEYS.tourCompleted) !== '1') {
    setTimeout(startPageTour, 700);
  }
}
