import { contextBridge, ipcRenderer } from 'electron'
import type { ApiResponse } from '@shared/api'

// The only bridge between the screens and the rest of the app: one generic call channel.
contextBridge.exposeInMainWorld('bridge', {
  invoke: (method: string, args: unknown[]): Promise<ApiResponse> => ipcRenderer.invoke('api', method, args)
})
