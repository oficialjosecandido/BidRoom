/**
 * Mutates the SSR ResponseInit so crawlers get a real HTTP status
 * (avoids Soft 404: HTTP 200 with "not found" HTML).
 * Pass the optional RESPONSE_INIT inject result — no-op when null (browser).
 */
export function applySsrStatus(
  init: { status?: number; statusText?: string } | null | undefined,
  status: number,
  statusText = 'Not Found'
): void {
  if (!init) return;
  init.status = status;
  init.statusText = statusText;
}
