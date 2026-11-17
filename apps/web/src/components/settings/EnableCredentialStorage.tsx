import { useState } from 'react';
import { Button } from '@alune/ui';
import { uiAgent } from '../../api/ui-agent';

export function EnableCredentialStorage({ refresh }: { refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  if (!uiAgent) return null;
  return (
    <div>
      <Button
        loading={busy}
        onClick={async () => {
          if (!uiAgent || busy) return;
          setBusy(true);
          setError('');
          try {
            await uiAgent.prepareCredentials();
            await refresh();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : '无法启用本机凭据存储。');
          } finally {
            setBusy(false);
          }
        }}
      >
        启用本机凭据存储
      </Button>
      {error && <p role="status">{error}</p>}
    </div>
  );
}
