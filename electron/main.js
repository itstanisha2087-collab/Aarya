const { app, BrowserWindow, Tray, Menu, ipcMain } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');
const http = require('http');

// ── Single Instance Lock (Race Condition & Multiple Instances Prevention) ──
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[AARYA/Electron] Duplicate instance detected. Terminating...');
  app.quit();
  process.exit(0);
} else {
  app.on('second-instance', () => {
    console.log('[AARYA/Electron] Second instance triggered. Focus active window.');
    showAaryaWindow();
  });
}

let mainWindow = null;
let tray = null;
let server = null;
let isQuitting = false;

// ── Command Line Startup Args ──
const startMinimized = process.argv.includes('--minimized') || process.argv.includes('--hidden') || !isDev;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,          // starts completely hidden to prevent white flashes or blank frames
    frame: false,         // frameless window for cinematic sci-fi HUD
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    roundedCorners: true,
    darkTheme: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  
  // Forward renderer console logs to main process console for autonomous debugging
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[RENDER CONSOLE] [Level:${level}] ${message} (Source: ${sourceId}:${line})`);
  });

  const startUrl = isDev 
    ? 'http://127.0.0.1:3000' 
    : `file://${path.join(__dirname, '../out/index.html')}`;

  // ── Robust HTTP Polling System (Race Condition Prevention) ──
  if (isDev) {
    pollFrontend(startUrl, () => {
      if (mainWindow) {
        mainWindow.loadURL(startUrl);
      }
    });
  } else {
    mainWindow.loadURL(startUrl);
  }

  // If in development mode, open Chrome DevTools (detached)
  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Intercept window close to minimize to system tray instead of exiting
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      console.log('[AARYA/Electron] Window minimized to system tray.');
    }
    return false;
  });

  mainWindow.once('ready-to-show', () => {
    console.log('[AARYA/Electron] Frameless window ready to show.');
    
    if (startMinimized) {
      // Production/tray mode: start hidden in system tray
      mainWindow.hide();
      console.log('[AARYA/Electron] AARYA started minimized in system tray.');
    } else {
      // Dev mode: show window immediately for development
      mainWindow.show();
      mainWindow.focus();
      console.log('[AARYA/Electron] AARYA window shown (dev mode).');
    }
  });
}

// ── Zero-Dependency HTTP Polling Utility ──
function pollFrontend(url, callback) {
  console.log(`[AARYA/Electron] Waiting for Next.js dev server ready state at ${url}...`);
  
  const checkServer = () => {
    const req = http.get(url, (res) => {
      // 200 OK or 300 redirect means Next.js is fully up and ready to serve assets
      if (res.statusCode >= 200 && res.statusCode < 400) {
        console.log('[AARYA/Electron] Next.js dev server is ready! Launching app rendering...');
        callback();
      } else {
        console.log(`[AARYA/Electron] Next.js returned status ${res.statusCode}. Retrying in 1000ms...`);
        setTimeout(checkServer, 1000);
      }
    });

    req.on('error', (err) => {
      // Standard ECONNREFUSED error before Next.js dev server boots up
      console.log(`[AARYA/Electron] Dev port 3000 busy or not listening: ${err.message}. Retrying...`);
      setTimeout(checkServer, 1000);
    });

    req.end();
  };

  checkServer();
}

function showAaryaWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.restore();
    mainWindow.focus();
    mainWindow.setAlwaysOnTop(true);
    
    setTimeout(() => {
      if (mainWindow) {
        mainWindow.setAlwaysOnTop(false);
      }
    }, 1500);
    
    // Send an IPC event to trigger Next.js cinematic wake overlay
    mainWindow.webContents.send('aarya-wake-event', true);
    console.log('[AARYA/Electron] AARYA native window brought to foreground!');
  }
}

function createTray() {
  const iconPath = path.join(__dirname, 'icon.png');
  try {
    tray = new Tray(iconPath);
    
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Open AARYA', click: () => showAaryaWindow() },
      { label: 'Restart Voice Engine', click: () => {
          if (mainWindow) {
            mainWindow.reload();
            console.log('[AARYA/Electron] Voice Engine reloaded.');
          }
        }
      },
      { type: 'separator' },
      { label: 'Quit', click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ]);

    tray.setToolTip('AARYA Ambient AI Assistant');
    tray.setContextMenu(contextMenu);

    // Single click: restore/show window
    tray.on('click', () => {
      showAaryaWindow();
    });

    // Double click: maximize window
    tray.on('double-click', () => {
      showAaryaWindow();
      if (mainWindow && !mainWindow.isMaximized()) {
        mainWindow.maximize();
      }
    });
    console.log('[AARYA/Electron] System tray registered successfully.');
  } catch (err) {
    console.error('[AARYA/Electron] Failed to create Tray Icon:', err.message);
  }
}

// Zero-dependency local Node.js HTTP IPC server on port 3001
function startIpcServer() {
  server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let data = {};
      try {
        if (body) data = JSON.parse(body);
      } catch (_) {}

      if (req.url === '/wake' && req.method === 'POST') {
        console.log('[AARYA/Electron] Received local IPC wake signal POST.');
        showAaryaWindow();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', message: 'Woken' }));
      } 
      else if (req.url === '/ambient-response' && req.method === 'POST') {
        console.log('[AARYA/Electron] Received ambient response POST event.');
        if (data.focus) {
          showAaryaWindow();
        }
        if (mainWindow) {
          mainWindow.webContents.send('aarya-ambient-response', data);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', message: 'Relayed' }));
      } 
      else if (req.url === '/stop' && req.method === 'POST') {
        console.log('[AARYA/Electron] Received global stop-speech POST event.');
        if (mainWindow) {
          mainWindow.webContents.send('aarya-stop-speech', true);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', message: 'Stopped' }));
      } 
      else {
        res.writeHead(404);
        res.end();
      }
    });
  });

  server.listen(3001, '127.0.0.1', () => {
    console.log('[AARYA/Electron] Local Node IPC server listening on http://127.0.0.1:3001');
  });
}

// ── Electron native wake request IPC pathway ──
ipcMain.on('wake-window-req', () => {
  console.log('[AARYA/Electron] Next.js requested native window wake via IPC bridge.');
  showAaryaWindow();
});

// ── Minimize window IPC pathway ──
ipcMain.on('minimize-window-req', () => {
  if (mainWindow) {
    mainWindow.minimize();
    console.log('[AARYA/Electron] Window minimized normally.');
  }
});

// ── Maximize window IPC pathway ──
ipcMain.on('maximize-window-req', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
      console.log('[AARYA/Electron] Window unmaximized.');
    } else {
      mainWindow.maximize();
      console.log('[AARYA/Electron] Window maximized.');
    }
  }
});

// ── Close window (Minimize to Tray) IPC pathway ──
ipcMain.on('close-window-req', () => {
  if (mainWindow) {
    mainWindow.hide();
    console.log('[AARYA/Electron] Window hidden (minimized to system tray) silently.');
  }
});

// ── Native Multimodal Audio Playback & SAIL Controller ──
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');

let activeAudioProcess = null;

ipcMain.on('play-audio', (event, base64Data) => {
  console.log('[AARYA/Electron] play-audio request received');
  
  // Enforce SAIL: terminate any currently active playback
  if (activeAudioProcess) {
    try {
      console.log('[SAIL] Terminating active audio subprocess forcefully');
      activeAudioProcess.kill('SIGKILL');
    } catch (_) {}
    activeAudioProcess = null;
  }
  
  if (!base64Data) {
    event.sender.send('audio-playback-completed');
    return;
  }

  const tmpPath = path.join(os.tmpdir(), `aarya_audio_${Date.now()}.wav`);
  try {
    const audioBuffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(tmpPath, audioBuffer);
    
    // Platform-native playback
    if (process.platform === 'win32') {
      activeAudioProcess = execFile('powershell', [
        '-c', `(New-Object Media.SoundPlayer "${tmpPath}").PlaySync()`
      ], () => {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        activeAudioProcess = null;
        console.log('[AARYA/Electron] Windows native playback completed');
        event.sender.send('audio-playback-completed');
      });
    } else if (process.platform === 'darwin') {
      activeAudioProcess = execFile('afplay', [tmpPath], () => {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        activeAudioProcess = null;
        console.log('[AARYA/Electron] macOS native playback completed');
        event.sender.send('audio-playback-completed');
      });
    } else {
      activeAudioProcess = execFile('aplay', [tmpPath], () => {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        activeAudioProcess = null;
        console.log('[AARYA/Electron] Linux native playback completed');
        event.sender.send('audio-playback-completed');
      });
    }
  } catch (err) {
    console.error('[AARYA/Electron] Native playback error:', err.message);
    event.sender.send('audio-playback-completed');
  }
});

ipcMain.on('stop-audio', () => {
  console.log('[AARYA/Electron] stop-audio request received');
  if (activeAudioProcess) {
    try {
      console.log('[SAIL] Stopping active audio subprocess forcefully');
      activeAudioProcess.kill('SIGKILL');
    } catch (_) {}
    activeAudioProcess = null;
  }
});

app.whenReady().then(() => {
  createWindow();
  createTray();
  startIpcServer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (server) {
    server.close();
    console.log('[AARYA/Electron] Local Node IPC server terminated.');
  }
});
