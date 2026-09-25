// Must evaluate before Prism: stops it from rewriting every `code.language-*`
// element on the page (Markdown in release notes uses those classes).
const scope = globalThis as { Prism?: { manual?: boolean } };
scope.Prism = { ...scope.Prism, manual: true };
