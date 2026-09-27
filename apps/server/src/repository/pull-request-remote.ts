import type { PullRequestRemote, RemoteInfo } from '@alune/shared';

// Only the fetch destination identifies the repository whose incoming PRs/MRs we list.
// URL credentials never leave this parser. SSH ports are not HTTPS API ports.
export function pullRequestRemote(remote: RemoteInfo): PullRequestRemote {
  const unavailable: PullRequestRemote = {
    name: remote.name,
    host: '',
    project: '',
    webUrl: '',
    provider: null,
    unavailableReason:
      '此远端地址无法识别。请使用包含真实主机名的 HTTPS、SSH 或 SCP 地址。',
  };
  try {
    const input = remote.fetchUrl;
    if (!input || /[\s\x00-\x1f\x7f]/.test(input)) return unavailable;
    let url: URL;
    let rawPath: string;
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(input)) {
      rawPath = input.replace(/^[a-z][a-z\d+.-]*:\/\/[^/]+/i, '');
      url = new URL(input);
    } else {
      const match = input.match(/^(?:[^/@:]+@)?(\[[^\]]+\]|[^/:]+):(.+)$/);
      if (!match) return unavailable;
      rawPath = match[2];
      url = new URL(`ssh://${match[1]}/${match[2]}`);
    }
    if (!['https:', 'ssh:'].includes(url.protocol) || url.search || url.hash)
      return unavailable;
    // Bare aliases such as gitlab-work cannot identify an API host reliably.
    if (!url.hostname.includes('.') && !url.hostname.startsWith('['))
      return unavailable;
    if (/(?:^|\/)(?:\.|\.\.)(?:\/|$)|\\/.test(decodeURIComponent(rawPath)))
      return unavailable;
    const project = decodeURIComponent(url.pathname)
      .replace(/^\//, '')
      .replace(/\.git\/?$/, '')
      .replace(/\/$/, '');
    const parts = project.split('/');
    if (
      parts.length < 2 ||
      parts.some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          /[\s\x00-\x1f\x7f\\?#]/.test(part),
      )
    )
      return unavailable;
    const host = url.protocol === 'https:' ? url.host : url.hostname;
    const provider =
      host === 'github.com'
        ? 'github'
        : host === 'gitlab.com'
          ? 'gitlab'
          : null;
    if (provider === 'github' && parts.length !== 2) return unavailable;
    return {
      name: remote.name,
      host,
      project,
      provider,
      webUrl: `https://${host}/${parts.map(encodeURIComponent).join('/')}`,
    };
  } catch {
    return unavailable;
  }
}
