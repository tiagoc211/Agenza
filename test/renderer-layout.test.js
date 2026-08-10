const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');

const html = readFileSync('src/renderer/index.html', 'utf8');
const renderer = readFileSync('src/renderer/index.js', 'utf8');
const styles = readFileSync('src/renderer/styles.css', 'utf8');

test('builds terminal panes from one reusable template instead of fixed pane ids', () => {
  assert.equal((html.match(/class="terminal-mount"/g) ?? []).length, 1);
  assert.equal((html.match(/class="terminal-pane"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /terminal-one|terminal-two/);
  assert.match(html, /id="terminal-pane-template"/);
  assert.match(renderer, /terminalPaneTemplate\.content\.firstElementChild\.cloneNode\(true\)/);
  assert.match(renderer, /pane\.dataset\.paneId = snapshot\.id/);
  assert.match(renderer, /new Terminal/);
  assert.match(renderer, /new FitAddon/);
});

test('adds and removes dynamic terminal sessions through the narrow bridge', () => {
  assert.match(html, /data-add-terminal/);
  assert.match(html, /data-empty-add-terminal/);
  assert.match(html, /data-remove-button/);
  assert.match(renderer, /window\.agenza\.terminal\.list\(\)/);
  assert.match(renderer, /window\.agenza\.terminal\.create\(\)/);
  assert.match(renderer, /window\.agenza\.terminal\.remove\(view\.id\)/);
  assert.match(renderer, /terminalViews\.delete\(view\.id\)/);
  assert.match(renderer, /view\.terminal\.dispose\(\)/);
  assert.match(renderer, /buildTerminalRemovalMessage/);
  assert.match(
    renderer,
    /This stops only this terminal's Codex process and removes its saved pane/,
  );
  assert.match(renderer, /The Git workspace will be kept/);
  assert.match(
    renderer,
    /No branch, worktree directory, project file, or Git registration will be deleted/,
  );
});

test('keeps zero, one, two, and several terminal layouts usable', () => {
  assert.match(html, /data-empty-workspace/);
  assert.match(renderer, /emptyWorkspace\.hidden = count !== 0/);
  assert.match(renderer, /terminalGrid\.dataset\.terminalCount = String\(count\)/);
  assert.match(styles, /repeat\(auto-fit, minmax\(min\(30rem, 100%\), 1fr\)\)/);
  assert.match(styles, /data-terminal-count='1'/);
  assert.match(styles, /data-terminal-count='2'/);
  assert.match(styles, /overflow: auto/);
  assert.match(renderer, /new ResizeObserver\(fitTerminals\)/);
});

test('keeps the directory and wrapping controls in separate non-overlapping header rows', () => {
  assert.match(styles, /\.pane-header \{[\s\S]*display: grid/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /\.pane-header p \{[\s\S]*max-width: 100%/);
  assert.match(styles, /\.pane-actions \{[\s\S]*flex-wrap: wrap/);
  assert.match(styles, /\.pane-actions \{[\s\S]*width: 100%/);
  assert.match(styles, /\.pane-identity > div \{[\s\S]*min-width: 0/);
});

test('gives every pane independent controls, process state, and a stable label', () => {
  for (const control of [
    'data-project-button',
    'data-worktree-button',
    'data-recovery-button',
    'data-git-refresh',
    'data-copy-button',
    'data-paste-button',
    'data-clear-button',
    'data-restart-button',
    'data-remove-button',
  ]) {
    assert.equal((html.match(new RegExp(control, 'g')) ?? []).length, 1);
  }

  assert.match(renderer, /typeof snapshot\.label === 'string'/);
  assert.match(renderer, /`Terminal \$\{fallbackLabelNumber\}`/);
  assert.match(renderer, /label,/);
  assert.match(renderer, /setSessionState\(view, 'connected', 'Connected', view\.projectFolder\)/);
  assert.match(renderer, /terminalViews\.get\(id\)\?\.terminal\.write\(data\)/);
  assert.match(renderer, /window\.agenza\.terminal\.resize\(view\.id/);
  assert.match(renderer, /window\.agenza\.terminal\.activate\(nextActiveId\)/);
});

test('shows and refreshes repository, branch, worktree, and change counts per pane', () => {
  for (const field of [
    'data-git-summary',
    'data-git-repository',
    'data-git-branch',
    'data-git-worktree',
    'data-git-changes',
    'data-git-status-message',
    'data-git-refresh',
  ]) {
    assert.equal((html.match(new RegExp(field, 'g')) ?? []).length, 1);
  }

  assert.match(renderer, /window\.agenza\.git\.status\(view\.id\)/);
  assert.match(renderer, /view\.workspace\?\.projectPath !== requestedWorkspacePath/);
  assert.match(renderer, /tracked > 0/);
  assert.match(renderer, /untracked > 0/);
  assert.match(renderer, /conflicted > 0/);
  assert.match(renderer, /view\.gitSummary\.dataset\.gitState = 'error'/);
  assert.match(renderer, /Unable to refresh Git status for this terminal/);
  assert.match(styles, /\.workspace-summary\[data-git-state='clean'\]/);
  assert.match(styles, /\.workspace-summary\[data-git-state='conflicted'\]/);
});

test('previews and confirms a new branch worktree for only the selected terminal', () => {
  for (const control of [
    'data-worktree-dialog',
    'data-worktree-form',
    'data-worktree-base',
    'data-worktree-branch',
    'data-worktree-path',
    'data-preview-repository',
    'data-preview-base',
    'data-preview-target',
    'data-preview-path',
    'data-confirm-worktree',
  ]) {
    assert.match(html, new RegExp(control));
  }

  assert.match(html, /Confirm this Git operation/);
  assert.match(html, /Other terminals and existing Git work remain unchanged/);
  assert.match(renderer, /window\.agenza\.git\.discover\(view\.id\)/);
  assert.match(renderer, /window\.agenza\.git\.planWorkspace\(state\.view\.id/);
  assert.match(renderer, /createNewBranch: 'create-new-branch-worktree'/);
  assert.match(
    renderer,
    /\[workspaceOperationTypes\.createNewBranch\]: window\.agenza\.git\.createNewBranch/,
  );
  assert.match(renderer, /confirmation\(state\.view\.id, state\.preview\.operationId\)/);
  assert.match(renderer, /view\.workspace = result\.operation\.workspace/);
  assert.match(renderer, /setControlsBusy\(view, true\)/);
  assert.match(styles, /\.workspace-dialog::backdrop/);
});

test('offers existing branches and registered worktrees as separate assignment flows', () => {
  for (const control of [
    'data-workspace-operation',
    'data-existing-branch',
    'data-existing-worktree',
    'data-existing-branch-field',
    'data-existing-worktree-field',
  ]) {
    assert.match(html, new RegExp(control));
  }

  assert.match(html, /value="create-existing-branch-worktree"/);
  assert.match(html, /value="attach-existing-worktree"/);
  assert.match(html, /Use an existing local branch/);
  assert.match(html, /Attach a registered worktree/);
  assert.match(renderer, /\.filter\(\(\{ worktreePath: checkedOutPath \}\) => !checkedOutPath\)/);
  assert.match(renderer, /window\.agenza\.git\.createExistingBranch/);
  assert.match(renderer, /window\.agenza\.git\.attachWorktree/);
  assert.match(renderer, /No branch, directory, or Git registration will be created or deleted/);
  assert.match(renderer, /setWorkspaceFieldVisible/);
  assert.match(styles, /\.workspace-dialog-field\[hidden\]/);
});

test('offers a separate confirmed cleanup that keeps the Git branch', () => {
  for (const control of [
    'data-cleanup-worktree',
    'data-cleanup-dialog',
    'data-cleanup-worktree-select',
    'data-preview-cleanup',
    'data-confirm-cleanup',
    'data-cleanup-repository',
    'data-cleanup-branch',
    'data-cleanup-path',
  ]) {
    assert.match(html, new RegExp(control));
  }

  assert.match(html, /This is separate from terminal removal/);
  assert.match(html, /without force/);
  assert.match(html, /local\s+branch and its commits will remain/);
  assert.match(renderer, /window\.agenza\.git\.listManagedWorktrees\(\)/);
  assert.match(renderer, /window\.agenza\.git\.previewCleanup\(cleanupSelect\.value\)/);
  assert.match(renderer, /window\.agenza\.git\.confirmCleanup\(state\.preview\.operationId\)/);
  assert.match(renderer, /worktree\.assignedTerminalId \? ' \(assigned to a terminal\)'/);
  assert.match(renderer, /Remove or reassign that terminal first/);
  assert.match(renderer, /Branch \$\{displayBranchName\(result\.operation\.branchRef\)\} was kept/);
  assert.match(styles, /\.dialog-button-danger/);
  assert.match(styles, /\.cleanup-worktree-button:disabled \{[\s\S]*cursor: not-allowed/);
  assert.match(styles, /\.workspace-dialog \{[\s\S]*max-height: calc\(100dvh - 2rem\)/);
  assert.match(styles, /\.workspace-dialog-form \{[\s\S]*overflow-y: auto/);
  assert.match(styles, /\.workspace-dialog-actions \{[\s\S]*position: sticky/);
  assert.match(
    styles,
    /\.workspace-dialog-form > \.workspace-dialog-field select \{[\s\S]*max-width: 100%/,
  );
  assert.match(
    styles,
    /@media \(max-width: 720px\) \{[\s\S]*\.workspace-actions \{[\s\S]*width: 100%/,
  );
});

test('restores persisted labels, active state, and available or missing project paths safely', () => {
  assert.match(
    renderer,
    /const snapshots = Array\.isArray\(catalog\) \? catalog : catalog\.sessions/,
  );
  assert.match(renderer, /catalog\.activeTerminalId/);
  assert.match(renderer, /snapshot\.workspaceStatus/);
  assert.match(renderer, /Restored project:/);
  assert.match(renderer, /restored project folder is missing or inaccessible/);
  assert.match(renderer, /Choose another folder to recover this terminal/);
  assert.match(renderer, /restartButton\.textContent = 'Start'/);
});

test('recovers stale Git assignments without deleting Git resources', () => {
  assert.match(html, /data-recovery-button/);
  assert.match(html, /Detach saved workspace/);
  assert.match(renderer, /workspaceStatus\?\.status === 'stale'/);
  assert.match(renderer, /Registered worktree found at/);
  assert.match(renderer, /window\.agenza\.terminal\.detachWorkspace\(view\.id\)/);
  assert.match(renderer, /Use Reassign Git to recover it/);
  assert.match(renderer, /No directory, branch, project file, or Git registration will be deleted/);
  assert.match(renderer, /Any Agenza ownership record will remain available/);
  assert.doesNotMatch(renderer, /git\s+prune|worktree\s+prune/);
  assert.match(styles, /\.pane-recovery-button:not\(:disabled\)/);
  assert.match(styles, /\.pane-recovery-button\[hidden\]/);
});

test('selects and displays an independent project folder before starting each session', () => {
  assert.match(renderer, /window\.agenza\.project\.selectFolder\(view\.id\)/);
  assert.match(renderer, /window\.agenza\.terminal\.start\(view\.id\)/);
  assert.match(renderer, /window\.agenza\.terminal\.restart\(view\.id\)/);
  assert.match(
    renderer,
    /applyWorkspaceAvailability\(view, \{ path: result\.path, status: 'available' \}\)/,
  );
  assert.match(renderer, /Choose a project folder to start Codex/);
});

test('preserves independent clear, restart, and terminal-local recovery behavior', () => {
  assert.match(renderer, /window\.agenza\.terminal\.write\(view\.id, '\\x0c'\)/);
  assert.match(renderer, /view\.terminal\.reset\(\)/);
  assert.match(renderer, /Use Restart above to launch this session again/);
  assert.match(renderer, /setSessionState\(view, 'exited', 'Exited'/);
  assert.match(renderer, /const formatUserFacingError/);
  assert.match(renderer, /const formatUserFacingActionError/);
  assert.match(renderer, /typeof error\?\.recovery === 'string'/);
  assert.match(renderer, /\.slice\(0, 500\)/);
  assert.match(renderer, /Check that Codex works in a normal terminal/);
  assert.match(renderer, /Choose a readable and writable project folder/);
});

test('tracks one active pane and cycles focus across the current dynamic order', () => {
  assert.match(html, /aria-keyshortcuts="F6 Shift\+F6"/);
  assert.ok((html.match(/aria-live="polite"/g) ?? []).length >= 3);
  assert.match(renderer, /terminalGrid\.querySelectorAll\('\[data-pane-id\]'\)/);
  assert.match(renderer, /classList\.toggle\('is-active'/);
  assert.match(renderer, /const isTerminalFocusShortcut/);
  assert.match(renderer, /!event\.altKey/);
  assert.match(renderer, /!event\.ctrlKey/);
  assert.match(renderer, /!event\.metaKey/);
  assert.match(renderer, /const focusAdjacentTerminal/);
  assert.match(renderer, /views\.length === 0/);
  assert.match(renderer, /document\.activeElement\?\.closest/);
  assert.match(renderer, /direction: event\.shiftKey \? -1 : 1/);
  assert.match(renderer, /nextView\.terminal\.focus\(\)/);
  assert.match(renderer, /nextView\.pane\.scrollIntoView/);
  assert.match(renderer, /worktreeDialog\.open \|\|/);
  assert.match(renderer, /cleanupDialog\.open/);
  assert.match(styles, /\.terminal-pane:focus-within/);
  assert.match(styles, /\.pane-action-button:focus-visible/);
});

test('names workspace actions and announces terminal-local state changes accessibly', () => {
  assert.match(html, /aria-label="Add a new terminal"/);
  assert.match(html, /aria-label="Clean an Agenza-created worktree"/);
  assert.match(html, /aria-controls="cleanup-worktree-dialog"/);
  assert.match(html, /aria-labelledby="git-workspace-dialog-title"/);
  assert.match(html, /aria-describedby="git-workspace-dialog-intro"/);
  assert.match(html, /aria-labelledby="cleanup-worktree-dialog-title"/);
  assert.match(html, /data-workspace-announcement/);
  assert.match(renderer, /Choose or change the project folder for \$\{label\}/);
  assert.match(renderer, /Assign or reassign a Git workspace to \$\{label\}/);
  assert.match(renderer, /without deleting its project folder, worktree, or branch/);
  assert.match(renderer, /view\.pane\.setAttribute\('aria-busy', String\(isBusy\)\)/);
  assert.match(renderer, /\$\{view\.label\} status: \$\{label\}/);
  assert.match(renderer, /aria-expanded', 'true'/);
  assert.match(renderer, /aria-expanded', 'false'/);
  assert.match(renderer, /saved workspace was detached\. No Git resources were deleted/);
  assert.match(renderer, /removed\. Focus moved to/);
  assert.match(renderer, /Git operation is ready for confirmation/);
  assert.match(styles, /button:focus-visible,[\s\S]*outline: 2px solid #68d5ff/);
});

test('supports mouse selection and terminal-safe clipboard shortcuts in every new pane', () => {
  assert.match(renderer, /terminal\.onSelectionChange/);
  assert.match(renderer, /view\.terminal\.getSelection\(\)/);
  assert.match(renderer, /window\.agenza\.clipboard\.writeText\(selectedText\)/);
  assert.match(renderer, /window\.agenza\.clipboard\.readText\(\)/);
  assert.match(renderer, /view\.terminal\.paste\(text\)/);
  assert.match(renderer, /attachCustomKeyEventHandler/);
  assert.match(renderer, /event\.shiftKey \|\| view\.terminal\.hasSelection\(\)/);
  assert.ok((renderer.match(/event\.preventDefault\(\)/g) ?? []).length >= 3);
  assert.ok((renderer.match(/event\.stopPropagation\(\)/g) ?? []).length >= 3);
});
