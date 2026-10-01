import { useEffect, useState } from 'react';
import { createFeedbackStore, feedbackText, Button } from '@alune/ui';

export default function Example() {
  const [store] = useState(createFeedbackStore);
  const [entries, setEntries] = useState(store.getState().entries);
  useEffect(() => store.subscribe((state) => setEntries(state.entries)), [store]);
  return (
    <>
      <p>
        {feedbackText(
          <span>
            状态示例：<strong>来源去重</strong>
          </span>,
        )}
      </p>
      <Button
        onClick={() =>
          store
            .getState()
            .publish({
              id: 'sample',
              scope: 'demo',
              context: '模拟项目',
              revision: '1',
              title: '示例错误',
              type: 'error',
              mode: 'modal',
            })
        }
      >
        发布同一修订
      </Button>
      <Button onClick={() => store.getState().acknowledge('sample')}>标为已读</Button>
      <Button onClick={() => store.getState().rearm('sample')}>允许再次提示</Button>
      <pre>
        {JSON.stringify(
          entries.map(({ id, queued, title }) => ({ id, queued, title })),
          null,
          2,
        )}
      </pre>
    </>
  );
}
