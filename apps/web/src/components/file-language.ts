// Maps a file name to a Prism grammar id and a readable label. Kept apart from
// the highlighter so the files view can name the language before Prism loads.
export interface FileLanguage {
  id: string;
  label: string;
}

const languages: Record<string, FileLanguage> = {
  typescript: { id: 'typescript', label: 'TypeScript' },
  tsx: { id: 'tsx', label: 'TSX' },
  javascript: { id: 'javascript', label: 'JavaScript' },
  jsx: { id: 'jsx', label: 'JSX' },
  json: { id: 'json', label: 'JSON' },
  css: { id: 'css', label: 'CSS' },
  scss: { id: 'scss', label: 'SCSS' },
  less: { id: 'less', label: 'Less' },
  markup: { id: 'markup', label: 'HTML / XML' },
  markdown: { id: 'markdown', label: 'Markdown' },
  yaml: { id: 'yaml', label: 'YAML' },
  bash: { id: 'bash', label: 'Shell' },
  python: { id: 'python', label: 'Python' },
  go: { id: 'go', label: 'Go' },
  rust: { id: 'rust', label: 'Rust' },
  java: { id: 'java', label: 'Java' },
  kotlin: { id: 'kotlin', label: 'Kotlin' },
  c: { id: 'c', label: 'C' },
  cpp: { id: 'cpp', label: 'C++' },
  csharp: { id: 'csharp', label: 'C#' },
  ruby: { id: 'ruby', label: 'Ruby' },
  sql: { id: 'sql', label: 'SQL' },
  toml: { id: 'toml', label: 'TOML' },
  ini: { id: 'ini', label: 'INI' },
  docker: { id: 'docker', label: 'Dockerfile' },
  diff: { id: 'diff', label: 'Diff' },
  graphql: { id: 'graphql', label: 'GraphQL' },
  swift: { id: 'swift', label: 'Swift' },
  lua: { id: 'lua', label: 'Lua' },
  makefile: { id: 'makefile', label: 'Makefile' },
  properties: { id: 'properties', label: 'Properties' },
};

const byExtension: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  webmanifest: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'markup',
  htm: 'markup',
  xhtml: 'markup',
  xml: 'markup',
  svg: 'markup',
  vue: 'markup',
  plist: 'markup',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  py: 'python',
  pyi: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  sql: 'sql',
  toml: 'toml',
  ini: 'ini',
  cfg: 'ini',
  diff: 'diff',
  patch: 'diff',
  graphql: 'graphql',
  gql: 'graphql',
  swift: 'swift',
  lua: 'lua',
  mk: 'makefile',
  properties: 'properties',
};

const byName: Record<string, string> = {
  dockerfile: 'docker',
  containerfile: 'docker',
  makefile: 'makefile',
  gnumakefile: 'makefile',
  '.editorconfig': 'ini',
  '.gitconfig': 'ini',
  '.npmrc': 'ini',
  '.bashrc': 'bash',
  '.zshrc': 'bash',
  '.profile': 'bash',
  gemfile: 'ruby',
  rakefile: 'ruby',
};

export function fileLanguage(path: string): FileLanguage | null {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (byName[name]) return languages[byName[name]];
  if (name.startsWith('dockerfile.')) return languages.docker;
  if (name === '.env' || name.startsWith('.env.')) return languages.bash;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = byExtension[name.slice(dot + 1)];
  return id ? languages[id] : null;
}
