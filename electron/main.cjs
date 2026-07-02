const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

const DEV_URL = process.env.SURFACE_DEV_URL;

app.setAppUserModelId('com.surface.tasks');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#121215',
    autoHideMenuBar: true,
    title: 'Surface',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // open external links in the default browser, not in the app window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (DEV_URL) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

Menu.setApplicationMenu(null);

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
