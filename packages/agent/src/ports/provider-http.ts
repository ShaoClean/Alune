export type TraceHttp = (
  source: string,
  method: string,
  url: string | URL,
  context: Record<string, unknown>,
  send: () => Promise<Response>,
) => Promise<Response>;
export const sendUntraced: TraceHttp = (_source, _method, _url, _context, send) => send();
