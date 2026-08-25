const { app, BrowserWindow, Menu, net, protocol } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_SCHEME = 'othello';
const DIST_ROOT = path.resolve(__dirname, '..', 'dist');

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

function localFileFor(requestUrl) {
  const url = new URL(requestUrl);
  const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const filePath = path.resolve(DIST_ROOT, relativePath);
  const insideDist = filePath === DIST_ROOT || filePath.startsWith(`${DIST_ROOT}${path.sep}`);
  return insideDist ? filePath : null;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#7fa5e8',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (!targetUrl.startsWith(`${APP_SCHEME}://app/`)) event.preventDefault();
  });
  win.once('ready-to-show', () => win.show());
  void win.loadURL(`${APP_SCHEME}://app/index.html`);
}

app.whenReady().then(() => {
  app.setAppUserModelId('io.github.hasai666.othello3d');
  protocol.handle(APP_SCHEME, (request) => {
    const filePath = localFileFor(request.url);
    if (!filePath) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(filePath).toString());
  });

  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
