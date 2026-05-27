const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  wakeWindow: () => ipcRenderer.send('wake-window-req'),
  minimizeWindow: () => ipcRenderer.send('minimize-window-req')
});

contextBridge.exposeInMainWorld('electronAPI', {
  onWake: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('aarya-wake-event', subscription);
    return () => {
      ipcRenderer.removeListener('aarya-wake-event', subscription);
    };
  }
});
