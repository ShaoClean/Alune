// GET a bounded official runtime artifact. A retry discards the entire failed
// transfer; the caller still checks the final archive against SHASUMS256.
import { setTimeout as delay } from 'node:timers/promises';
const transient = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);
export async function downloadRuntime(
  url,
  limit,
  {
    fetchImpl = fetch,
    signal = AbortSignal.timeout(180000),
    backoff = (ms) => delay(ms, undefined, { signal }),
  } = {},
) {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      const response = await fetchImpl(url, { signal });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw Object.assign(new Error('Node download failed: ' + response.status), {
          retryStatus: response.status,
        });
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > limit) throw new Error('Node download exceeded expected size limit');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (error) {
      signal.throwIfAborted();
      if (
        attempt >= 2 ||
        (!transient.has(error.cause?.code ?? error.code) &&
          ![502, 503, 504].includes(error.retryStatus))
      )
        throw error;
      await backoff(500 * 2 ** attempt);
    }
  }
}
