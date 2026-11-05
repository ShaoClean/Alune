// Only selected by the isolated --smoke-test boot path; never connects to GitHub or installs.
module.exports.createUpdateAdapter = (version) => ({
  installs: 0,
  async check() { return {
    version: require('semver').inc(version, 'patch'),
    releaseNotes: '# Smoke release notes\n\n- **Markdown**\n\n[Release](https://github.com/ShaoClean/Alune/releases)\n\n```text\n**literal**\n```\n\n| Platform | Status |\n| --- | --- |\n| Desktop | Ready |\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert%281%29)',
  }; },
  async download(signal, progress) {
    for (let percent = 0; percent <= 100; percent += 10) {
      signal.throwIfAborted();
      progress({ percent, transferred: percent, total: 100, bytesPerSecond: 100 });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return '/mock/verified-installer';
  },
  async install() { this.installs++; },
  async openFile() {},
});
