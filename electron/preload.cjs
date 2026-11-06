const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('desktop', {
  getUpdateState: () => ipcRenderer.invoke('assistant:update-state'),
  checkForUpdates: () => ipcRenderer.invoke('assistant:update-check'),
  downloadUpdate: () => ipcRenderer.invoke('assistant:update-download'),
  installUpdate: () => ipcRenderer.invoke('assistant:update-install'),
  getLicenseState: () => ipcRenderer.invoke('assistant:license-state'),
  verifyLicense: () => ipcRenderer.invoke('assistant:license-verify'),
  activateLicense: (code) =>
    ipcRenderer.invoke('assistant:license-activate', code),
  initialize: () => ipcRenderer.invoke('assistant:initialize'),
  exportLogs: () => ipcRenderer.invoke('assistant:export-logs'),
  prepareAccount: (account) =>
    ipcRenderer.invoke('assistant:prepare-account', account),
  bindGuest: (accountId, guestId) =>
    ipcRenderer.invoke('assistant:bind-guest', accountId, guestId),
  refreshAccount: (accountId) =>
    ipcRenderer.invoke('assistant:refresh-account', accountId),
  removeAccount: (accountId, platform) =>
    ipcRenderer.invoke('assistant:remove-account', accountId, platform),
  collect: (accountId) => ipcRenderer.invoke('assistant:collect', accountId),
  start: (accountId, config, talentIds) =>
    ipcRenderer.invoke('assistant:start', accountId, config, talentIds),
  stop: (accountId) => ipcRenderer.invoke('assistant:stop', accountId),
  resolveRecord: (recordId, sent) =>
    ipcRenderer.invoke('assistant:resolve-record', recordId, sent),
  onEvent: (callback) => {
    const handler = (_, event) => callback(event)
    ipcRenderer.on('assistant:event', handler)
    return () => ipcRenderer.removeListener('assistant:event', handler)
  },
})
