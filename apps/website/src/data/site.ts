const repository = 'https://github.com/ShaoClean/Alune';
export const site = {
  name: 'Alune',
  title: 'Alune | 本地与 SSH 远程 Git 工作区',
  description:
    '在桌面上，统一管理本地与 SSH 远程 Git 仓库。查看差异、暂存提交、浏览历史与 PR/MR，让日常 Git 工作留在同一个工作区。支持 macOS、Windows 和 Linux。',
  repository,
  download: `${repository}/releases/latest`,
  releases: `${repository}/releases`,
  docs: `${repository}/wiki`,
  workspace: `${repository}/blob/development/docs/workspace.md`,
  installation: `${repository}/blob/development/docs/desktop.md`,
  ai: `${repository}/blob/development/docs/ai-settings.md`,
  proxy: `${repository}/blob/development/docs/network-proxy.md`,
  changelog: `${repository}/issues/97`,
  feedback: `${repository}/issues/new/choose`,
};
export const navigation = [
  { href: '#workspaces', label: '工作区' },
  { href: '#changes', label: '查看与提交' },
  { href: '#collaboration', label: '分支与协作' },
  { href: '#experience', label: '使用体验' },
];
export const platforms = [
  {
    name: 'macOS',
    architecture: 'Apple 芯片',
    file: 'mac-arm64.dmg',
    instruction: '打开 DMG，将 Alune 拖入「应用程序」。',
    icon: 'apple',
  },
  {
    name: 'macOS',
    architecture: 'Intel 芯片',
    file: 'mac-x64.dmg',
    instruction: '打开 DMG，将 Alune 拖入「应用程序」。',
    icon: 'apple',
  },
  {
    name: 'Windows',
    architecture: 'x64',
    file: 'win-x64.exe',
    instruction: '运行安装程序，按提示选择安装位置。',
    icon: 'windows',
  },
  {
    name: 'Linux',
    architecture: 'x64',
    file: 'linux-x86_64.AppImage',
    instruction: '允许文件作为程序执行，然后打开 AppImage。',
    icon: 'linux',
  },
] as const;
