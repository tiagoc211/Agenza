import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import './styles.css';

const environment = document.querySelector('#environment');
const terminalGrid = document.querySelector('[data-terminal-grid]');
const terminalPaneTemplate = document.querySelector('#terminal-pane-template');
const addTerminalButton = document.querySelector('[data-add-terminal]');
const emptyAddTerminalButton = document.querySelector('[data-empty-add-terminal]');
const emptyWorkspace = document.querySelector('[data-empty-workspace]');
const terminalCount = document.querySelector('[data-terminal-count]:not(.terminal-grid)');
const worktreeDialog = document.querySelector('[data-worktree-dialog]');
const worktreeForm = document.querySelector('[data-worktree-form]');
const worktreeIntro = document.querySelector('[data-worktree-intro]');
const worktreeFields = document.querySelector('[data-worktree-fields]');
const worktreeRepository = document.querySelector('[data-worktree-repository]');
const workspaceOperation = document.querySelector('[data-workspace-operation]');
const baseBranchField = document.querySelector('[data-base-branch-field]');
const worktreeBase = document.querySelector('[data-worktree-base]');
const newBranchField = document.querySelector('[data-new-branch-field]');
const worktreeBranch = document.querySelector('[data-worktree-branch]');
const existingBranchField = document.querySelector('[data-existing-branch-field]');
const existingBranch = document.querySelector('[data-existing-branch]');
const existingWorktreeField = document.querySelector('[data-existing-worktree-field]');
const existingWorktree = document.querySelector('[data-existing-worktree]');
const worktreePathField = document.querySelector('[data-worktree-path-field]');
const worktreePath = document.querySelector('[data-worktree-path]');
const worktreeError = document.querySelector('[data-worktree-error]');
const worktreePreview = document.querySelector('[data-worktree-preview]');
const previewRepository = document.querySelector('[data-preview-repository]');
const previewBase = document.querySelector('[data-preview-base]');
const previewTarget = document.querySelector('[data-preview-target]');
const previewTargetLabel = document.querySelector('[data-preview-target-label]');
const previewPath = document.querySelector('[data-preview-path]');
const previewExplanation = document.querySelector('[data-preview-explanation]');
const previewButton = document.querySelector('[data-preview-button]');
const confirmWorktreeButton = document.querySelector('[data-confirm-worktree]');
const cancelWorktreeButtons = document.querySelectorAll('[data-cancel-worktree]');

const terminalTheme = {
  background: '#090c12',
  foreground: '#d8dee9',
  cursor: '#68d5ff',
  cursorAccent: '#090c12',
  selectionBackground: '#27425c',
  black: '#171b24',
  brightBlack: '#5e6a7d',
  blue: '#6ea8fe',
  brightBlue: '#92bdff',
  cyan: '#68d5ff',
  brightCyan: '#9ce6ff',
  green: '#73d69c',
  brightGreen: '#99e8ba',
  magenta: '#c69cff',
  brightMagenta: '#dbbdff',
  red: '#ff7a90',
  brightRed: '#ff9bad',
  white: '#d8dee9',
  brightWhite: '#ffffff',
  yellow: '#f4ca78',
  brightYellow: '#ffe09c',
};

const terminalViews = new Map();
let nextLabelNumber = 1;
let resizeFrame;
let activeTerminalId = null;
let workspaceRecoveryIssue = null;
let worktreeDialogState = null;

const workspaceOperationTypes = Object.freeze({
  attachWorktree: 'attach-existing-worktree',
  createExistingBranch: 'create-existing-branch-worktree',
  createNewBranch: 'create-new-branch-worktree',
});

const getOrderedViews = () => [...terminalViews.values()];

const setActivePane = (activePane, { persist = true } = {}) => {
  const nextActiveId = activePane?.dataset.paneId ?? null;
  const previousActiveId = activeTerminalId;

  for (const { pane } of terminalViews.values()) {
    const isActive = pane === activePane;
    pane.classList.toggle('is-active', isActive);
    pane.dataset.activePane = String(isActive);
  }

  activeTerminalId = nextActiveId;

  if (persist && nextActiveId !== previousActiveId) {
    window.agenza.terminal.activate(nextActiveId).catch(() => {
      // A failed active-pane save does not interrupt any running terminal.
    });
  }
};

const updateWorkspaceLayout = () => {
  const count = terminalViews.size;

  terminalGrid.dataset.terminalCount = String(count);
  emptyWorkspace.hidden = count !== 0;
  terminalCount.textContent =
    count === 0 ? 'No terminals' : `${count} ${count === 1 ? 'terminal' : 'terminals'}`;
};

const fitTerminals = () => {
  window.cancelAnimationFrame(resizeFrame);
  resizeFrame = window.requestAnimationFrame(() => {
    for (const { fitAddon } of terminalViews.values()) {
      fitAddon.fit();
    }
  });
};

const resizeObserver = new ResizeObserver(fitTerminals);
resizeObserver.observe(terminalGrid);

const setSessionState = (view, state, label, description) => {
  view.pane.dataset.sessionState = state;
  view.stateElement.textContent = label;
  view.descriptionElement.textContent = description;
  view.descriptionElement.title = description;
  view.restartButton.classList.toggle(
    'is-recovery-action',
    state === 'exited' || state === 'error',
  );
};

const formatUserFacingError = (error, fallback = 'An unexpected error occurred.') => {
  const message = typeof error?.message === 'string' ? error.message : fallback;
  const printableMessage = [...message]
    .map((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint >= 32 && (codePoint < 127 || codePoint > 159) ? character : ' ';
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

  return (printableMessage || fallback).slice(0, 500);
};

const showSessionFailure = (view, { description, error, heading, recovery }) => {
  view.terminal.writeln(`\r\n\x1b[31m${heading}\x1b[0m`);
  view.terminal.writeln(`\x1b[31m${formatUserFacingError(error)}\x1b[0m`);
  view.terminal.writeln(`\x1b[90m${recovery}\x1b[0m`);
  setSessionState(view, 'error', 'Error', description);
};

const setControlsBusy = (view, isBusy) => {
  view.isBusy = isBusy;
  view.clearButton.disabled = isBusy;
  view.projectButton.disabled = isBusy;
  view.worktreeButton.disabled = isBusy || !view.projectFolder;
  view.pasteButton.disabled = isBusy || !view.isConnected;
  view.restartButton.disabled = isBusy || !view.projectFolder;
  view.removeButton.disabled = isBusy;
};

const branchToPathSegment = (branch) =>
  branch
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'workspace';

const deriveWorktreePath = (repositoryRoot, branch) => {
  const separator = repositoryRoot.includes('\\') ? '\\' : '/';
  const trimmedRoot = repositoryRoot.replace(/[\\/]+$/, '');
  const lastSeparator = Math.max(trimmedRoot.lastIndexOf('\\'), trimmedRoot.lastIndexOf('/'));
  const parent = lastSeparator >= 0 ? trimmedRoot.slice(0, lastSeparator) : trimmedRoot;
  const repositoryName = lastSeparator >= 0 ? trimmedRoot.slice(lastSeparator + 1) : 'repository';
  return `${parent}${separator}${repositoryName}-${branchToPathSegment(branch)}`;
};

const resetWorktreePreview = () => {
  if (worktreeDialogState) {
    worktreeDialogState.preview = null;
  }

  worktreePreview.hidden = true;
  confirmWorktreeButton.disabled = true;
};

const setWorktreeDialogError = (error = null, fallback) => {
  worktreeError.textContent = error ? formatUserFacingError(error, fallback) : '';
  worktreeError.hidden = !error;
};

const closeWorktreeDialog = () => {
  if (worktreeDialog.open) {
    worktreeDialog.close();
  }
};

const replaceSelectOptions = (select, items, emptyLabel) => {
  if (items.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = emptyLabel;
    select.replaceChildren(option);
    return;
  }

  select.replaceChildren(
    ...items.map(({ label, value }) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      return option;
    }),
  );
};

const setWorkspaceFieldVisible = (field, control, isVisible) => {
  field.hidden = !isVisible;
  control.disabled = !isVisible;
};

const getConfirmationLabel = (type) => {
  switch (type) {
    case workspaceOperationTypes.createExistingBranch:
      return 'Create worktree';
    case workspaceOperationTypes.attachWorktree:
      return 'Attach worktree';
    default:
      return 'Create branch and worktree';
  }
};

const configureWorkspaceOperation = ({ resetPath = false } = {}) => {
  const state = worktreeDialogState;

  if (!state?.repository) {
    return;
  }

  const type = workspaceOperation.value;
  const createsNewBranch = type === workspaceOperationTypes.createNewBranch;
  const usesExistingBranch = type === workspaceOperationTypes.createExistingBranch;
  const attachesWorktree = type === workspaceOperationTypes.attachWorktree;

  setWorkspaceFieldVisible(baseBranchField, worktreeBase, createsNewBranch);
  setWorkspaceFieldVisible(newBranchField, worktreeBranch, createsNewBranch);
  setWorkspaceFieldVisible(existingBranchField, existingBranch, usesExistingBranch);
  setWorkspaceFieldVisible(existingWorktreeField, existingWorktree, attachesWorktree);
  setWorkspaceFieldVisible(worktreePathField, worktreePath, !attachesWorktree);

  if (resetPath) {
    state.pathIsAutomatic = true;
  }

  if (state.pathIsAutomatic && !attachesWorktree) {
    const branch = createsNewBranch ? worktreeBranch.value : existingBranch.value;
    worktreePath.value = deriveWorktreePath(state.repository.root, branch);
  }

  if (createsNewBranch) {
    worktreeIntro.textContent =
      'Create a new local branch and an isolated sibling worktree for this terminal.';
  } else if (usesExistingBranch) {
    worktreeIntro.textContent =
      'Create a new worktree for a local branch that is not checked out elsewhere.';
  } else {
    worktreeIntro.textContent =
      'Assign an existing registered worktree without creating or deleting Git resources.';
  }

  confirmWorktreeButton.textContent = getConfirmationLabel(type);
  resetWorktreePreview();
  setWorktreeDialogError();
};

const openGitWorkspaceDialog = async (view) => {
  if (view.isBusy || !view.projectFolder || worktreeDialog.open) {
    return;
  }

  const token = Symbol('worktree-dialog');
  worktreeDialogState = {
    isCreating: false,
    pathIsAutomatic: true,
    preview: null,
    repository: null,
    token,
    view,
  };
  setControlsBusy(view, true);
  worktreeForm.reset();
  worktreeFields.hidden = true;
  worktreeIntro.hidden = false;
  worktreeIntro.textContent = `Loading the repository for ${view.label}...`;
  previewButton.disabled = true;
  resetWorktreePreview();
  setWorktreeDialogError();
  worktreeDialog.showModal();

  try {
    const result = await window.agenza.git.discover(view.id);

    if (worktreeDialogState?.token !== token) {
      return;
    }

    if (!result.ok) {
      throw result.error;
    }

    const repository = result.repository;
    worktreeDialogState.repository = repository;
    worktreeRepository.textContent = repository.root;
    replaceSelectOptions(
      worktreeBase,
      repository.branches.map(({ name }) => ({ label: name, value: name })),
      'No local branches available',
    );
    worktreeBase.value = repository.currentBranch ?? repository.branches[0]?.name ?? '';
    replaceSelectOptions(
      existingBranch,
      repository.branches
        .filter(({ worktreePath: checkedOutPath }) => !checkedOutPath)
        .map(({ name }) => ({ label: name, value: name })),
      'No eligible local branches',
    );
    replaceSelectOptions(
      existingWorktree,
      repository.worktrees
        .filter(
          ({ bare, branch, branchRef, detached, locked, prunable }) =>
            !bare && branch && branchRef && !detached && !locked && !prunable,
        )
        .map(({ branch, path }) => ({ label: `${branch} - ${path}`, value: path })),
      'No eligible registered worktrees',
    );
    workspaceOperation.value = workspaceOperationTypes.createNewBranch;
    worktreeBranch.value = `agenza/${branchToPathSegment(view.label).toLowerCase()}`;
    configureWorkspaceOperation({ resetPath: true });
    worktreeFields.hidden = false;
    previewButton.disabled = false;
    worktreeBranch.focus();
    worktreeBranch.select();
  } catch (error) {
    if (worktreeDialogState?.token === token) {
      worktreeIntro.textContent = "Agenza could not inspect this terminal's repository.";
      setWorktreeDialogError(error, 'Unable to inspect this Git repository.');
    }
  }
};

const previewGitWorkspace = async () => {
  const state = worktreeDialogState;

  if (!state?.repository || previewButton.disabled || !worktreeForm.reportValidity()) {
    return;
  }

  resetWorktreePreview();
  setWorktreeDialogError();
  previewButton.disabled = true;
  previewButton.textContent = 'Reviewing...';

  try {
    const type = workspaceOperation.value;
    let request;

    if (type === workspaceOperationTypes.createNewBranch) {
      request = {
        baseBranch: worktreeBase.value,
        targetBranch: worktreeBranch.value.trim(),
        type,
        worktreePath: worktreePath.value.trim(),
      };
    } else if (type === workspaceOperationTypes.createExistingBranch) {
      request = {
        targetBranch: existingBranch.value,
        type,
        worktreePath: worktreePath.value.trim(),
      };
    } else {
      request = {
        type,
        worktreePath: existingWorktree.value,
      };
    }

    const result = await window.agenza.git.planWorkspace(state.view.id, request);

    if (worktreeDialogState !== state) {
      return;
    }

    if (!result.ok) {
      throw result.error;
    }

    state.preview = result.preview;
    previewRepository.textContent = result.preview.repositoryRoot;
    previewBase.textContent = `${result.preview.baseBranch} (${result.preview.baseRevision.slice(0, 12)})`;
    previewTarget.textContent = result.preview.targetBranch;
    previewPath.textContent = result.preview.worktreePath;
    previewTargetLabel.textContent =
      type === workspaceOperationTypes.createNewBranch
        ? 'New branch'
        : type === workspaceOperationTypes.createExistingBranch
          ? 'Existing branch'
          : 'Attached branch';
    previewExplanation.textContent =
      type === workspaceOperationTypes.createNewBranch
        ? 'Agenza will create this local branch and worktree, assign them to this terminal, and start Codex. Other terminals remain unchanged.'
        : type === workspaceOperationTypes.createExistingBranch
          ? 'Agenza will create only this worktree for the existing branch, assign it to this terminal, and start Codex. The branch will not be recreated or deleted.'
          : 'Agenza will only assign this registered worktree and restart this terminal. No branch, directory, or Git registration will be created or deleted.';
    worktreePreview.hidden = false;
    confirmWorktreeButton.textContent = getConfirmationLabel(type);
    confirmWorktreeButton.disabled = false;
    confirmWorktreeButton.focus();
  } catch (error) {
    if (worktreeDialogState === state) {
      setWorktreeDialogError(error, 'Unable to preview this Git operation.');
    }
  } finally {
    if (worktreeDialogState === state) {
      previewButton.disabled = false;
      previewButton.textContent = 'Review operation';
    }
  }
};

const confirmGitWorkspace = async () => {
  const state = worktreeDialogState;

  if (!state?.preview || confirmWorktreeButton.disabled) {
    return;
  }

  confirmWorktreeButton.disabled = true;
  previewButton.disabled = true;
  confirmWorktreeButton.textContent =
    state.preview.type === workspaceOperationTypes.attachWorktree ? 'Assigning...' : 'Creating...';
  state.isCreating = true;
  for (const button of cancelWorktreeButtons) {
    button.disabled = true;
  }
  state.view.isRestarting = true;
  setWorktreeDialogError();

  try {
    const confirmation = {
      [workspaceOperationTypes.attachWorktree]: window.agenza.git.attachWorktree,
      [workspaceOperationTypes.createExistingBranch]: window.agenza.git.createExistingBranch,
      [workspaceOperationTypes.createNewBranch]: window.agenza.git.createNewBranch,
    }[state.preview.type];
    const result = await confirmation(state.view.id, state.preview.operationId);

    if (worktreeDialogState !== state) {
      return;
    }

    if (!result.ok) {
      resetWorktreePreview();
      throw result.error;
    }

    const view = state.view;
    view.workspace = result.operation.workspace;
    view.projectFolder = result.operation.workspace.projectPath;
    view.projectButton.textContent = 'Change folder';
    view.restartButton.textContent = 'Restart';

    if (result.session?.isRunning) {
      view.isConnected = true;
      view.terminal.options.disableStdin = false;
      setSessionState(view, 'connected', 'Connected', view.projectFolder);
      view.fitAddon.fit();
      window.agenza.terminal.resize(view.id, view.terminal.cols, view.terminal.rows);
      setActivePane(view.pane);
      view.terminal.focus();
    } else if (result.terminalError) {
      view.isConnected = false;
      view.terminal.options.disableStdin = true;
      showSessionFailure(view, {
        description: 'Workspace assigned - Codex start needs attention',
        error: result.terminalError,
        heading: 'The Git workspace was assigned, but Codex did not start.',
        recovery: 'The workspace assignment is saved. Use Restart to try Codex again.',
      });
    }

    closeWorktreeDialog();
  } catch (error) {
    if (worktreeDialogState === state) {
      setWorktreeDialogError(error, 'Unable to assign this Git workspace.');
    }
  } finally {
    state.view.isRestarting = false;

    if (worktreeDialogState === state) {
      state.isCreating = false;
      confirmWorktreeButton.textContent = getConfirmationLabel(workspaceOperation.value);
      previewButton.disabled = false;
      for (const button of cancelWorktreeButtons) {
        button.disabled = false;
      }
    }
  }
};

const copyTerminalSelection = async (view) => {
  const selectedText = view.terminal.getSelection();

  if (selectedText) {
    await window.agenza.clipboard.writeText(selectedText);
  }
};

const pasteIntoTerminal = async (view) => {
  if (!view.isConnected) {
    return;
  }

  const text = await window.agenza.clipboard.readText();

  if (text) {
    view.terminal.paste(text);
  }

  setActivePane(view.pane);
  view.terminal.focus();
};

const runClipboardAction = (action) => {
  action().catch(() => {
    // Clipboard errors stay local to the requested action and never affect another PTY.
  });
};

const launchSession = async (view, { restart, failureMessage }) => {
  setControlsBusy(view, true);
  view.isRestarting = restart;
  view.isConnected = false;
  view.terminal.options.disableStdin = true;
  view.terminal.reset();
  view.terminal.writeln(`\x1b[1;36mAgenza · ${view.label}\x1b[0m`);
  view.terminal.writeln(`\x1b[90mProject: ${view.projectFolder}\x1b[0m`);
  setSessionState(
    view,
    restart ? 'restarting' : 'starting',
    restart ? 'Restarting' : 'Starting',
    view.projectFolder,
  );

  try {
    const snapshot = restart
      ? await window.agenza.terminal.restart(view.id)
      : await window.agenza.terminal.start(view.id);

    if (!snapshot.isRunning) {
      throw new Error('The Codex process did not stay running.');
    }

    view.isConnected = true;
    view.terminal.options.disableStdin = false;
    view.restartButton.textContent = 'Restart';
    setSessionState(view, 'connected', 'Connected', view.projectFolder);
    view.fitAddon.fit();
    window.agenza.terminal.resize(view.id, view.terminal.cols, view.terminal.rows);
    setActivePane(view.pane);
    view.terminal.focus();
  } catch (error) {
    view.isConnected = false;
    view.terminal.options.disableStdin = true;
    showSessionFailure(view, {
      description: 'Codex could not start - check setup and retry',
      error,
      heading: `${failureMessage}.`,
      recovery: 'Check that Codex works in a normal terminal, then restart Agenza and retry.',
    });
  } finally {
    view.isRestarting = false;
    setControlsBusy(view, false);
  }
};

const chooseProjectFolder = async (view) => {
  if (view.isBusy) {
    return;
  }

  setControlsBusy(view, true);
  view.projectButton.textContent = 'Selecting...';

  try {
    const result = await window.agenza.project.selectFolder(view.id);

    if (result.canceled) {
      return;
    }

    const isRestart = view.isConnected;
    view.projectFolder = result.path;
    view.workspace = {
      kind: 'folder',
      projectPath: result.path,
      repository: null,
    };
    await launchSession(view, {
      restart: isRestart,
      failureMessage: 'Unable to use project folder',
    });
  } catch (error) {
    view.isConnected = false;
    view.terminal.options.disableStdin = true;
    showSessionFailure(view, {
      description: 'Project folder unavailable - choose another folder',
      error,
      heading: 'Unable to use project folder.',
      recovery: 'Choose a readable and writable project folder, then try again.',
    });
  } finally {
    setControlsBusy(view, false);
    view.projectButton.textContent = view.projectFolder ? 'Change folder' : 'Choose folder';
  }
};

const removeTerminalView = async (view) => {
  if (view.isBusy) {
    return;
  }

  const confirmed = window.confirm(
    `Remove ${view.label}? This stops only its Codex process. Project files are not deleted.`,
  );

  if (!confirmed) {
    return;
  }

  const viewsBeforeRemoval = getOrderedViews();
  const removedIndex = viewsBeforeRemoval.indexOf(view);
  const wasActive = view.pane.classList.contains('is-active');
  view.isRemoving = true;
  setControlsBusy(view, true);
  setSessionState(view, 'stopping', 'Stopping', 'Stopping this terminal process');

  try {
    await window.agenza.terminal.remove(view.id);
  } catch (error) {
    view.isRemoving = false;
    showSessionFailure(view, {
      description: 'Terminal could not be removed - retry or close Agenza',
      error,
      heading: 'Unable to remove terminal.',
      recovery: 'Retry removal. Closing Agenza will also stop every terminal process.',
    });
    setControlsBusy(view, false);
    return;
  }

  terminalViews.delete(view.id);
  view.terminal.dispose();
  view.pane.remove();
  updateWorkspaceLayout();

  const remainingViews = getOrderedViews();

  if (wasActive && remainingViews.length > 0) {
    const nextView = remainingViews[Math.min(removedIndex, remainingViews.length - 1)];
    setActivePane(nextView.pane);
    nextView.terminal.focus();
  } else if (remainingViews.length === 0) {
    setActivePane(null);
    addTerminalButton.focus();
  }

  fitTerminals();
};

const configureTerminalShortcuts = (view) => {
  view.terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') {
      return true;
    }

    const key = event.key.toLowerCase();
    const commandKey = event.ctrlKey || event.metaKey;
    const copyShortcut =
      (commandKey && key === 'c' && (event.shiftKey || view.terminal.hasSelection())) ||
      (event.ctrlKey && key === 'insert');
    const pasteShortcut =
      (commandKey && key === 'v') || (event.shiftKey && !commandKey && key === 'insert');

    if (copyShortcut) {
      event.preventDefault();
      event.stopPropagation();
      runClipboardAction(() => copyTerminalSelection(view));
      return false;
    }

    if (pasteShortcut) {
      event.preventDefault();
      event.stopPropagation();
      runClipboardAction(() => pasteIntoTerminal(view));
      return false;
    }

    return true;
  });
};

const createTerminalView = (snapshot, { activate = true } = {}) => {
  if (typeof snapshot?.id !== 'string' || terminalViews.has(snapshot.id)) {
    throw new Error('Agenza received an invalid or duplicate terminal session.');
  }

  const fallbackLabelNumber = nextLabelNumber++;
  const label =
    typeof snapshot.label === 'string' && snapshot.label.length > 0
      ? snapshot.label
      : `Terminal ${fallbackLabelNumber}`;
  const numberedLabel = /^Terminal (\d+)$/.exec(label);
  const displayNumber = numberedLabel
    ? Number.parseInt(numberedLabel[1], 10)
    : (snapshot.order ?? fallbackLabelNumber - 1) + 1;
  nextLabelNumber = Math.max(nextLabelNumber, displayNumber + 1);
  const pane = terminalPaneTemplate.content.firstElementChild.cloneNode(true);
  const mount = pane.querySelector('[data-terminal-mount]');
  const title = pane.querySelector('[data-terminal-title]');
  const titleId = `terminal-title-${snapshot.id}`;
  const projectButton = pane.querySelector('[data-project-button]');
  const worktreeButton = pane.querySelector('[data-worktree-button]');
  const copyButton = pane.querySelector('[data-copy-button]');
  const pasteButton = pane.querySelector('[data-paste-button]');
  const clearButton = pane.querySelector('[data-clear-button]');
  const restartButton = pane.querySelector('[data-restart-button]');
  const removeButton = pane.querySelector('[data-remove-button]');

  pane.dataset.paneId = snapshot.id;
  pane.dataset.activePane = 'false';
  pane.setAttribute('aria-labelledby', titleId);
  title.id = titleId;
  title.textContent = label;
  pane.querySelector('[data-terminal-number]').textContent = String(displayNumber).padStart(2, '0');
  mount.id = `terminal-mount-${snapshot.id}`;
  mount.setAttribute('aria-label', `${label} Codex console`);
  copyButton.setAttribute('aria-label', `Copy selected text from ${label}`);
  pasteButton.setAttribute('aria-label', `Paste text into ${label}`);
  clearButton.setAttribute('aria-label', `Clear ${label}`);
  restartButton.setAttribute('aria-label', `Restart ${label}`);
  worktreeButton.setAttribute('aria-label', `Assign a Git workspace to ${label}`);
  removeButton.setAttribute('aria-label', `Remove ${label}`);
  terminalGrid.append(pane);

  const terminal = new Terminal({
    allowTransparency: false,
    convertEol: true,
    cursorBlink: true,
    disableStdin: true,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: 14,
    lineHeight: 1.25,
    screenReaderMode: true,
    scrollback: 5000,
    theme: terminalTheme,
  });
  const fitAddon = new FitAddon();

  terminal.loadAddon(fitAddon);
  terminal.open(mount);
  terminal.writeln(`\x1b[1;36mAgenza · ${label}\x1b[0m`);
  terminal.writeln('');
  const restoredWorkspace = snapshot.workspace ?? {
    kind: 'unassigned',
    projectPath: null,
    repository: null,
  };
  const restoredStatus = snapshot.workspaceStatus ?? { status: 'unassigned' };
  const restoredFolder =
    restoredStatus.status === 'available' ? restoredWorkspace.projectPath : null;

  if (restoredStatus.status === 'available') {
    terminal.writeln(`\x1b[90mRestored project: ${restoredWorkspace.projectPath}\x1b[0m`);
    terminal.writeln('\x1b[90mUse Start above to launch Codex.\x1b[0m');
  } else if (restoredStatus.status === 'missing') {
    terminal.writeln('\x1b[31mThe restored project folder is missing or inaccessible.\x1b[0m');
    terminal.writeln(`\x1b[90mSaved path: ${restoredWorkspace.projectPath}\x1b[0m`);
    terminal.writeln('\x1b[90mChoose another folder to recover this terminal.\x1b[0m');
  } else {
    terminal.writeln('\x1b[90mChoose a project folder to start Codex.\x1b[0m');
  }

  if (workspaceRecoveryIssue) {
    terminal.writeln(`\r\n\x1b[31m${workspaceRecoveryIssue}\x1b[0m`);
  }

  const view = {
    clearButton,
    copyButton,
    descriptionElement: pane.querySelector('[data-terminal-description]'),
    fitAddon,
    id: snapshot.id,
    isBusy: false,
    isConnected: snapshot.isRunning,
    isRemoving: false,
    isRestarting: false,
    label,
    pane,
    pasteButton,
    projectButton,
    projectFolder: restoredFolder,
    removeButton,
    restartButton,
    stateElement: pane.querySelector('[data-terminal-state]'),
    terminal,
    workspace: restoredWorkspace,
    worktreeButton,
  };

  terminalViews.set(view.id, view);

  if (restoredStatus.status === 'available') {
    projectButton.textContent = 'Change folder';
    restartButton.textContent = 'Start';
    restartButton.disabled = false;
    worktreeButton.disabled = false;
    setSessionState(view, 'waiting', 'Ready', restoredWorkspace.projectPath);
  } else if (restoredStatus.status === 'missing') {
    setSessionState(view, 'error', 'Unavailable', restoredWorkspace.projectPath);
  }

  pane.addEventListener('pointerdown', (event) => {
    setActivePane(pane);

    if (!event.target.closest?.('button') && !event.target.closest?.('.xterm')) {
      terminal.focus();
    }
  });
  pane.addEventListener('focusin', () => setActivePane(pane));
  terminal.onData((data) => {
    if (view.isConnected) {
      window.agenza.terminal.write(view.id, data);
    }
  });
  terminal.onResize(({ cols, rows }) => {
    if (view.isConnected) {
      window.agenza.terminal.resize(view.id, cols, rows);
    }
  });
  terminal.onSelectionChange(() => {
    view.copyButton.disabled = !terminal.hasSelection();
  });

  projectButton.addEventListener('click', () => chooseProjectFolder(view));
  worktreeButton.addEventListener('click', () => openGitWorkspaceDialog(view));
  copyButton.addEventListener('click', () => {
    runClipboardAction(() => copyTerminalSelection(view));
  });
  pasteButton.addEventListener('click', () => {
    runClipboardAction(() => pasteIntoTerminal(view));
  });
  clearButton.addEventListener('click', () => {
    if (view.isConnected) {
      window.agenza.terminal.write(view.id, '\x0c');
    } else {
      view.terminal.reset();
    }

    setActivePane(view.pane);
    view.terminal.focus();
  });
  restartButton.addEventListener('click', () => {
    if (view.projectFolder && !view.isBusy) {
      launchSession(view, {
        restart: true,
        failureMessage: 'Unable to restart Codex',
      });
    }
  });
  removeButton.addEventListener('click', () => removeTerminalView(view));
  configureTerminalShortcuts(view);

  updateWorkspaceLayout();
  fitTerminals();

  if (activate) {
    setActivePane(pane, { persist: false });
    terminal.focus();
  }

  return view;
};

const addTerminal = async () => {
  addTerminalButton.disabled = true;
  emptyAddTerminalButton.disabled = true;

  try {
    const snapshot = await window.agenza.terminal.create();
    createTerminalView(snapshot);
    addTerminalButton.title = '';
  } catch (error) {
    addTerminalButton.title = formatUserFacingError(error, 'Unable to add a terminal.');
    terminalCount.textContent = 'Unable to add terminal';
  } finally {
    addTerminalButton.disabled = false;
    emptyAddTerminalButton.disabled = false;
  }
};

const disposeDataSubscription = window.agenza.terminal.onData(({ id, data }) => {
  terminalViews.get(id)?.terminal.write(data);
});

const disposeExitSubscription = window.agenza.terminal.onExit(({ id, exitCode }) => {
  const view = terminalViews.get(id);

  if (!view || view.isRemoving) {
    return;
  }

  view.isConnected = false;
  view.terminal.options.disableStdin = true;

  if (view.isRestarting) {
    return;
  }

  view.terminal.writeln(`\r\n\x1b[31mCodex exited unexpectedly with code ${exitCode}.\x1b[0m`);
  view.terminal.writeln('\x1b[90mUse Restart above to launch this session again.\x1b[0m');
  setSessionState(view, 'exited', 'Exited', 'Codex stopped — restart available');
  view.restartButton.disabled = !view.projectFolder || view.isBusy;
});

const handleTerminalFocusShortcut = (event) => {
  if (event.key !== 'F6' || event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }

  const views = getOrderedViews();

  if (views.length < 2) {
    return;
  }

  event.preventDefault();
  const activeIndex = views.findIndex(({ pane }) => pane.classList.contains('is-active'));
  const direction = event.shiftKey ? -1 : 1;
  const startingIndex = activeIndex === -1 ? (event.shiftKey ? 0 : views.length - 1) : activeIndex;
  const nextIndex = (startingIndex + direction + views.length) % views.length;
  const nextView = views[nextIndex];

  setActivePane(nextView.pane);
  nextView.terminal.focus();
};

document.addEventListener('keydown', handleTerminalFocusShortcut);
addTerminalButton.addEventListener('click', () => addTerminal());
emptyAddTerminalButton.addEventListener('click', () => addTerminal());
workspaceOperation.addEventListener('change', () => {
  configureWorkspaceOperation({ resetPath: true });
});
worktreeBase.addEventListener('change', resetWorktreePreview);
worktreeBranch.addEventListener('input', () => {
  if (worktreeDialogState?.pathIsAutomatic && worktreeDialogState.repository) {
    worktreePath.value = deriveWorktreePath(
      worktreeDialogState.repository.root,
      worktreeBranch.value,
    );
  }

  resetWorktreePreview();
});
existingBranch.addEventListener('change', () => {
  if (worktreeDialogState?.pathIsAutomatic && worktreeDialogState.repository) {
    worktreePath.value = deriveWorktreePath(
      worktreeDialogState.repository.root,
      existingBranch.value,
    );
  }

  resetWorktreePreview();
});
existingWorktree.addEventListener('change', resetWorktreePreview);
worktreePath.addEventListener('input', () => {
  if (worktreeDialogState) {
    worktreeDialogState.pathIsAutomatic = false;
  }

  resetWorktreePreview();
});
previewButton.addEventListener('click', () => previewGitWorkspace());
confirmWorktreeButton.addEventListener('click', () => confirmGitWorkspace());
for (const button of cancelWorktreeButtons) {
  button.addEventListener('click', closeWorktreeDialog);
}
worktreeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  previewGitWorkspace();
});
worktreeDialog.addEventListener('cancel', (event) => {
  if (worktreeDialogState?.isCreating) {
    event.preventDefault();
  }
});
worktreeDialog.addEventListener('close', () => {
  const view = worktreeDialogState?.view;
  worktreeDialogState = null;
  worktreeForm.reset();
  worktreeFields.hidden = true;
  worktreePreview.hidden = true;
  setWorktreeDialogError();
  confirmWorktreeButton.disabled = true;
  confirmWorktreeButton.textContent = 'Create branch and worktree';
  previewButton.disabled = true;
  previewButton.textContent = 'Review operation';
  for (const button of cancelWorktreeButtons) {
    button.disabled = false;
  }

  if (view && terminalViews.has(view.id)) {
    setControlsBusy(view, false);
  }
});

const initializeWorkspace = async () => {
  try {
    const catalog = await window.agenza.terminal.list();
    const snapshots = Array.isArray(catalog) ? catalog : catalog.sessions;
    workspaceRecoveryIssue = Array.isArray(catalog) ? null : catalog.recoveryIssue;

    for (const snapshot of snapshots) {
      createTerminalView(snapshot, { activate: false });
    }

    const restoredActiveId = Array.isArray(catalog)
      ? snapshots.find(({ isActive }) => isActive)?.id
      : catalog.activeTerminalId;
    const firstView = terminalViews.get(restoredActiveId) ?? getOrderedViews()[0];

    if (firstView) {
      setActivePane(firstView.pane, { persist: false });
    }

    if (workspaceRecoveryIssue) {
      terminalCount.title = workspaceRecoveryIssue;
    }
  } catch (error) {
    emptyWorkspace.querySelector('p').textContent = formatUserFacingError(
      error,
      'Agenza could not load its terminals. Add a new terminal to retry.',
    );
  } finally {
    terminalGrid.dataset.workspaceReady = 'true';
    updateWorkspaceLayout();
    fitTerminals();
  }
};

initializeWorkspace();

window.addEventListener('beforeunload', () => {
  document.removeEventListener('keydown', handleTerminalFocusShortcut);
  resizeObserver.disconnect();
  disposeDataSubscription();
  disposeExitSubscription();

  for (const { terminal } of terminalViews.values()) {
    terminal.dispose();
  }
});

if (environment) {
  environment.textContent = window.agenza.platform;
}
