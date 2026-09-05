const ENDPOINT = 'https://opencode.ai/zen/v1/responses';
const MODEL = 'muse-spark-1.3-contributor-free';
const REASONING_EFFORT = 'xhigh';
const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export class ZenError extends Error {
  constructor(code, message, { status = null, retryable = false } = {}) {
    super(message);
    this.name = 'ZenError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export function extractResponseText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text;
  const chunks = [];
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (typeof part?.text === 'string') chunks.push(part.text);
      else if (typeof part?.output_text === 'string') chunks.push(part.output_text);
    }
  }
  return chunks.join('').trim();
}

function retryAfterMs(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

function sleep(ms, signal) {
  if (!signal) return new Promise(resolve => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.reject(signal.reason || new ZenError('CANCELLED', 'Muse request cancelled.'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason || new ZenError('CANCELLED', 'Muse request cancelled.'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function sanitizedMessage(raw, status) {
  let parsed = {};
  try { parsed = JSON.parse(raw); } catch {}
  const message = String(parsed?.error?.message || parsed?.message || raw || `OpenCode Zen request failed (${status})`)
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .slice(0, 800);
  if (status === 401) return new ZenError('AUTH_FAILED', 'OpenCode Zen authentication failed. Check OPENCODE_ZEN_API_KEY.', { status });
  if (status === 403) return new ZenError('FORBIDDEN', 'OpenCode Zen rejected access to the requested model.', { status });
  if (status === 404) return new ZenError('MODEL_NOT_FOUND', `OpenCode Zen model or endpoint was not found: ${message}`, { status });
  if (status === 429) return new ZenError('RATE_LIMITED', `OpenCode Zen rate limit reached: ${message}`, { status, retryable: true });
  return new ZenError('ZEN_HTTP_ERROR', message, { status, retryable: RETRYABLE.has(status) });
}

function linkedAbortSignal(external, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new ZenError('TIMEOUT', `OpenCode Zen request exceeded ${timeoutMs} milliseconds.`)), timeoutMs);
  const onAbort = () => controller.abort(external?.reason || new ZenError('CANCELLED', 'Muse request cancelled.'));
  if (external) {
    if (external.aborted) onAbort();
    else external.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      external?.removeEventListener('abort', onAbort);
    },
  };
}

export class OpenCodeZenClient {
  constructor({ apiKey = process.env.OPENCODE_ZEN_API_KEY, fetchImpl = globalThis.fetch } = {}) {
    if (!apiKey || /\s/.test(apiKey)) throw new ZenError('MISSING_API_KEY', 'OPENCODE_ZEN_API_KEY is missing or invalid.');
    if (typeof fetchImpl !== 'function') throw new ZenError('NO_FETCH', 'Node.js fetch is unavailable.');
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
  }

  async complete({ instructions, input, maxOutputTokens = 20_000, timeoutMs = 720_000, retries = 3, signal } = {}) {
    if (!instructions || !input) throw new ZenError('INVALID_REQUEST', 'Both instructions and input are required.');
    const body = { model: MODEL, instructions, input, max_output_tokens: maxOutputTokens, reasoning: { effort: REASONING_EFFORT } };

    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (signal?.aborted) throw new ZenError('CANCELLED', 'Muse request cancelled.');
      const linked = linkedAbortSignal(signal, timeoutMs);
      try {
        const response = await this.fetch(ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(body),
          signal: linked.signal,
        });

        if (!response.ok) {
          const error = sanitizedMessage(await response.text().catch(() => ''), response.status);
          error.retryAfter = response.headers.get('retry-after');
          throw error;
        }

        const data = await response.json();
        const text = extractResponseText(data);
        if (!text) throw new ZenError('EMPTY_RESPONSE', 'OpenCode Zen returned no usable Muse response.');
        return { text, data, model: data?.model || MODEL, usage: data?.usage || null, reasoningEffort: data?.reasoning?.effort || data?.reasoning_effort || REASONING_EFFORT };
      } catch (caught) {
        if (signal?.aborted) throw new ZenError('CANCELLED', 'Muse request cancelled.');
        if (linked.signal.reason?.code === 'TIMEOUT' || caught?.name === 'AbortError') {
          throw new ZenError('TIMEOUT', `OpenCode Zen request exceeded ${timeoutMs} milliseconds.`);
        }
        lastError = caught instanceof ZenError
          ? caught
          : new ZenError('NETWORK_ERROR', String(caught?.message || caught).slice(0, 800), { retryable: true });
        if (!lastError.retryable || attempt >= retries) throw lastError;
        const delay = Math.min(10_000, retryAfterMs(lastError.retryAfter) || (500 * (2 ** attempt)) + Math.floor(Math.random() * 250));
        await sleep(delay, signal);
      } finally {
        linked.dispose();
      }
    }
    throw lastError || new ZenError('ZEN_ERROR', 'OpenCode Zen request failed.');
  }
}

export const ZEN_ENDPOINT = ENDPOINT;
export const MUSE_MODEL = MODEL;
export const MUSE_REASONING_EFFORT = REASONING_EFFORT;
