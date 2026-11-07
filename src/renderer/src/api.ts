import type { Api, Remote } from '@shared/api'

async function invoke(method: string, args: unknown[]): Promise<unknown> {
  const res = await window.bridge.invoke(method, args)
  if (!res.ok) throw new Error(res.error)
  return res.data
}

function proxy(path: string[]): unknown {
  return new Proxy(() => undefined, {
    get: (_target, prop) => (typeof prop === 'string' && prop !== 'then' ? proxy([...path, prop]) : undefined),
    apply: (_target, _this, args: unknown[]) => invoke(path.join('.'), args)
  })
}

/** Typed client for the main process: `await api.items.search('tea')`. */
export const api = proxy([]) as Remote<Api>

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
