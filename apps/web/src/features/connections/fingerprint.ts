// OpenSSH prints unpadded base64; ssh2 verifies the same 32 bytes as lowercase hex.
export function hostFingerprint(value: string): string | undefined {
  const text = value.trim();
  if (/^[0-9a-f]{64}$/i.test(text)) return text.toLowerCase();
  const match = /^SHA256:([A-Za-z0-9+/]{43})=?$/.exec(text);
  if (!match) return;
  try {
    const bytes = atob(match[1] + '=');
    if (bytes.length !== 32 || btoa(bytes).replace(/=+$/, '') !== match[1]) return;
    return Array.from(bytes, (b) => b.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  } catch {
    return;
  }
}
