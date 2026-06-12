// preload.js — Context bridge between main process and renderer

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window control
  window: {
    hide: () => ipcRenderer.send('window:hide'),
  },

  // Settings (narrow interface — renderer never sees raw keys/tokens)
  settings: {
    getStatus:            ()              => ipcRenderer.invoke('settings:getStatus'),
    saveGeminiKey:        (key)           => ipcRenderer.invoke('settings:saveGeminiKey', key),
    saveGoogleCreds:      (id, secret)    => ipcRenderer.invoke('settings:saveGoogleCreds', { clientId: id, clientSecret: secret }),
    setClipboardConsent:  (value)         => ipcRenderer.invoke('settings:setClipboardConsent', value),
    clearAll:             ()              => ipcRenderer.invoke('settings:clearAll'),
  },

  // Google OAuth2
  auth: {
    google:   () => ipcRenderer.invoke('auth:google'),
    hasToken: () => ipcRenderer.invoke('auth:hasToken'),
  },

  // API calls (executed in main process)
  api: {
    analyze:     (text, timezone) => ipcRenderer.invoke('api:analyze', { text, timezone }),
    createEvent: (event)          => ipcRenderer.invoke('api:createEvent', event),
  },

  // Events from main process
  onShow: (callback) => {
    ipcRenderer.on('show-with-text', (_, text) => callback(text));
  },
  onClipboardConsentNeeded: (callback) => {
    ipcRenderer.on('clipboard-consent-needed', () => callback());
  },

  // System notification
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),
});
