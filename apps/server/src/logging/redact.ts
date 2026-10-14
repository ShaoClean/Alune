const REDACTED = '[REDACTED]';
const MAX_STRING = 4000;
const MAX_DEPTH = 4;
const MAX_KEYS = 40;

// Keys whose values are never written, regardless of their content.
const SENSITIVE_KEY =
  /pass(word|phrase|wd)?$|secret|token|authorization|api[-_]?key|private[-_]?key|cookie|credential/i;

const PATTERNS: [RegExp, string][] = [
  [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
    '[REDACTED PRIVATE KEY]',
  ],
  // Userinfo in any URL: https://user:token@host, ssh://user:pass@host.
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, '$1***@'],
  [
    /\b(authorization|proxy-authorization|private-token|x-api-key|x-goog-api-key|cookie)(\s*[:=]\s*)("?)[^\r\n",}]+/gi,
    `$1$2$3${REDACTED}`,
  ],
  [/\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`],
  [
    /([?&#](?:access_token|refresh_token|private_token|token|api[-_]?key|key|password|secret|sig|signature|code)=)[^&#\s"]+/gi,
    `$1${REDACTED}`,
  ],
  [
    /\b(password|passwd|pwd|passphrase|secret|token|access[-_]?token|api[-_]?key)\b(\s*[=:]\s*)("?)[^\s",}&#]+/gi,
    `$1$2$3${REDACTED}`,
  ],
  // Well-known token formats (GitHub, GitLab, OpenAI/Anthropic, Slack, Google).
  [
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})/g,
    REDACTED,
  ],
];

const literals = new Set<string>();

/** Registers a runtime secret (for example the desktop per-launch token) to be masked verbatim. */
export function registerSecret(value: string) {
  if (value && value.length >= 8) literals.add(value);
}

export function redactText(value: string): string {
  let text = value;
  for (const secret of literals)
    if (text.includes(secret)) text = text.split(secret).join(REDACTED);
  for (const [pattern, replacement] of PATTERNS)
    text = text.replace(pattern, replacement);
  return text.length > MAX_STRING
    ? `${text.slice(0, MAX_STRING)}…（已截断 ${text.length - MAX_STRING} 字符）`
    : text;
}

function redactValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Object]';
  seen.add(value);
  if (value instanceof Error) {
    const error: Record<string, unknown> = {
      name: value.name,
      message: redactText(value.message),
    };
    if (value.stack) error.stack = redactText(value.stack);
    const code = (value as NodeJS.ErrnoException).code;
    if (code) error.code = code;
    return error;
  }
  if (Array.isArray(value))
    return value
      .slice(0, MAX_KEYS)
      .map((item) => redactValue(item, depth + 1, seen));
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_KEYS))
    output[key] =
      SENSITIVE_KEY.test(key) &&
      item !== undefined &&
      item !== null &&
      item !== ''
        ? REDACTED
        : redactValue(item, depth + 1, seen);
  return output;
}

export function redactContext(
  context: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!context) return undefined;
  const value = redactValue(context, 0, new WeakSet()) as Record<
    string,
    unknown
  >;
  return Object.keys(value).length ? value : undefined;
}
