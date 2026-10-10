import { useEffect, useCallback } from 'react';

export function useExtensionMessage<T = unknown>(
  type: string,
  handler: (data: T) => void
) {
  const stableHandler = useCallback(handler, []);
  useEffect(() => {
    const listener = (event: MessageEvent<{ type: string; data: T }>) => {
      if (event.data?.type === type) {
        stableHandler(event.data.data);
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [type, stableHandler]);
}

// @ts-ignore - vscode API injected by VS Code webview runtime
export const vscodeApi = typeof acquireVsCodeApi !== 'undefined' ? acquireVsCodeApi() : null;

export function postMessage(type: string, data?: unknown) {
  vscodeApi?.postMessage({ type, data });
}
