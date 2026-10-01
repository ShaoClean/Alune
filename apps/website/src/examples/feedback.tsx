import { useState } from 'react';
import {
  Button,
  FeedbackScope,
  FeedbackNotice,
  FeedbackAlert,
  useFeedbackMessage,
  Switch,
  Space,
} from '@alune/ui';

export default function Example() {
  const [active, setActive] = useState(true);
  return (
    <>
      <label>
        <Switch aria-label="启用反馈作用域" checked={active} onChange={setActive} /> 启用作用域
      </label>
      <FeedbackScope id="example" label="示例项目" active={active}>
        <FeedbackActions />
      </FeedbackScope>
    </>
  );
}
function FeedbackActions() {
  const [revision, setRevision] = useState(0);
  const [failure, setFailure] = useState(false);
  const [rich, setRich] = useState(false);
  const message = useFeedbackMessage();
  return (
    <>
      <Space wrap>
        <Button
          onClick={() => {
            setFailure(true);
            setRevision((n) => n + 1);
          }}
        >
          产生可重试错误
        </Button>
        <Button onClick={() => message.warning('示例状态需要核对')}>发送警告</Button>
        <Button
          onClick={() => {
            message.error('第一条示例错误');
            message.info('第二条说明');
          }}
        >
          并发队列
        </Button>
        <Button onClick={() => setRich((v) => !v)}>切换富文本反馈</Button>
      </Space>
      <FeedbackNotice
        source="load"
        title={failure ? '示例加载失败' : null}
        description="同一来源、同一修订只提示一次。重试后移除。"
        eventKey={revision}
        type="error"
        actionLabel="重试"
        onAction={async () => {
          await new Promise((resolve) => setTimeout(resolve, 400));
          setFailure(false);
        }}
      />
      {rich && (
        <FeedbackAlert
          source="rich"
          title="使用限制"
          description={
            <span>
              此示例使用<strong>本地模拟数据</strong>。
            </span>
          }
        />
      )}
    </>
  );
}
