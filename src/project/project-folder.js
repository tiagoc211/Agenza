const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');

const { PROJECT_CHANNELS } = require('./ipc-channels');

const validateProjectFolder = async (
  folder,
  { fileSystem = fsPromises, pathModule = path } = {},
) => {
  if (typeof folder !== 'string' || !pathModule.isAbsolute(folder)) {
    throw new Error('Select a valid absolute project folder.');
  }

  const resolvedFolder = pathModule.resolve(folder);

  try {
    const stats = await fileSystem.stat(resolvedFolder);

    if (!stats.isDirectory()) {
      throw new Error('not-a-directory');
    }

    await fileSystem.access(resolvedFolder, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    throw new Error(`The selected project folder is not accessible: ${resolvedFolder}`);
  }

  return resolvedFolder;
};

const isTrustedEvent = (event, window) =>
  event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;

const registerProjectFolderIpc = ({
  defaultFolder = null,
  dialog,
  folderIds,
  initialFolders = {},
  ipcMain,
  isValidFolderId,
  onFolderSelected = async (_id, folder) => folder,
  skipDialog = false,
  validate = validateProjectFolder,
  window,
}) => {
  if (!dialog || !ipcMain || !window) {
    throw new TypeError('Project folder IPC requires dialog, ipcMain, and a window.');
  }

  if (isValidFolderId !== undefined && typeof isValidFolderId !== 'function') {
    throw new TypeError('Project folder IPC terminal validation must be a function.');
  }

  if (typeof onFolderSelected !== 'function') {
    throw new TypeError('Project folder IPC selection callback must be a function.');
  }

  if (!isValidFolderId && (!Array.isArray(folderIds) || folderIds.length === 0)) {
    throw new TypeError('Project folder IPC requires terminal id validation.');
  }

  const validFolderIds = new Set(folderIds ?? []);
  const isValidId = isValidFolderId ?? ((id) => validFolderIds.has(id));
  const currentFolders = new Map(Object.entries(initialFolders));

  const handleSelectFolder = async (event, payload) => {
    if (!isTrustedEvent(event, window)) {
      throw new Error('Untrusted project folder request.');
    }

    const { id } = payload ?? {};

    if (typeof id !== 'string' || !isValidId(id)) {
      throw new Error('Invalid terminal project id.');
    }

    const currentFolder = currentFolders.get(id) ?? defaultFolder;

    if (skipDialog && currentFolder) {
      const committedFolder = (await onFolderSelected(id, currentFolder)) ?? currentFolder;
      currentFolders.set(id, committedFolder);
      return { canceled: false, id, path: committedFolder };
    }

    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
      title: `Select a project folder for ${id}`,
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, id, path: currentFolder };
    }

    const selectedFolder = await validate(result.filePaths[0]);
    const committedFolder = (await onFolderSelected(id, selectedFolder)) ?? selectedFolder;
    currentFolders.set(id, committedFolder);
    return { canceled: false, id, path: committedFolder };
  };

  ipcMain.handle(PROJECT_CHANNELS.selectFolder, handleSelectFolder);

  return {
    dispose: () => ipcMain.removeHandler(PROJECT_CHANNELS.selectFolder),
    getCurrentFolder: (id) => currentFolders.get(id) ?? null,
  };
};

module.exports = {
  isTrustedEvent,
  registerProjectFolderIpc,
  validateProjectFolder,
};
