module.exports = {
  appId: 'com.remotegit.desktop',
  productName: 'RemoteGit',
  directories: { output: '../../release' },
  files: ['*.cjs', 'server/**/*', 'web/**/*', 'packages/**/*', 'package.json'],
  asar: true,
  asarUnpack: ['**/*.node'],
  npmRebuild: false,
  mac: { category: 'public.app-category.developer-tools', icon: '../../assets/icon.png', target: ['dmg', 'zip'] },
  win: { icon: '../../assets/icon.png', target: ['nsis'] },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true },
  linux: { category: 'Development', icon: '../../assets/icon.png', target: ['AppImage'] },
};
