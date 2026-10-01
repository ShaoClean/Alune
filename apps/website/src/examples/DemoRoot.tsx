import { Component, Suspense, lazy, useEffect, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { AluneUIProvider } from '@alune/ui';
const loaders = import.meta.glob<{
  default: ComponentType<{ theme?: 'light' | 'dark'; reduceMotion?: boolean }>;
}>('./*.tsx');
const components = Object.fromEntries(
  Object.entries(loaders)
    .filter(([key]) => !key.endsWith('/DemoRoot.tsx'))
    .map(([key, loader]) => [key, lazy(loader)]),
);
function report(id: string, type: 'ready' | 'error') {
  window.parent.postMessage({ channel: 'alune-ui-demo', id, type }, window.location.origin);
}
class DemoError extends Component<{ id: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    report(this.props.id, 'error');
  }
  render() {
    return this.state.failed ? (
      <p role="alert">示例加载失败，请使用重置按钮重试。</p>
    ) : (
      this.props.children
    );
  }
}
function Ready({ id, children }: { id: string; children: ReactNode }) {
  useEffect(() => {
    document.documentElement.dataset.previewReady = 'true';
    report(id, 'ready');
  }, [id]);
  return children;
}
export default function DemoRoot({ id }: { id: string }) {
  const [theme] = useState<'light' | 'dark'>(() =>
    new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light',
  );
  const [reduced] = useState(
    () =>
      new URLSearchParams(location.search).get('motion') === 'reduced' ||
      matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const Example = components[`./${id}.tsx`];
  if (!Example) return <p role="alert">没有找到这个示例。</p>;
  const content = (
    <DemoError id={id}>
      <Suspense fallback={<p role="status">正在加载示例…</p>}>
        <Ready id={id}>
          <Example theme={theme} reduceMotion={reduced} />
        </Ready>
      </Suspense>
    </DemoError>
  );
  return id === 'provider' ? (
    content
  ) : (
    <AluneUIProvider theme={theme} reduceMotion={reduced}>
      {content}
    </AluneUIProvider>
  );
}
