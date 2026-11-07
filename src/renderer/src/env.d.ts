/// <reference types="vite/client" />
import type { ApiResponse } from '@shared/api'

declare global {
  interface Window {
    bridge: {
      invoke(method: string, args: unknown[]): Promise<ApiResponse>
    }
  }
}

export {}
