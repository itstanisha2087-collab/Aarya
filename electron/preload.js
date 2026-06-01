const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ipcRenderer', {
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, func) => {
    const subscription = (event, ...args) => func(event, ...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  }
});

contextBridge.exposeInMainWorld('electron', {
  wakeWindow: () => ipcRenderer.send('wake-window-req'),
  minimizeWindow: () => ipcRenderer.send('minimize-window-req'),
  maximizeWindow: () => ipcRenderer.send('maximize-window-req'),
  closeWindow: () => ipcRenderer.send('close-window-req')
});

contextBridge.exposeInMainWorld('electronAPI', {
  onWake: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('aarya-wake-event', subscription);
    return () => {
      ipcRenderer.removeListener('aarya-wake-event', subscription);
    };
  },
  onAmbientResponse: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('aarya-ambient-response', subscription);
    return () => {
      ipcRenderer.removeListener('aarya-ambient-response', subscription);
    };
  },
  onStopSpeech: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('aarya-stop-speech', subscription);
    return () => {
      ipcRenderer.removeListener('aarya-stop-speech', subscription);
    };
  }
});
