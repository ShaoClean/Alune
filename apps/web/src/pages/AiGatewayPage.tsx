import { useEffect, useState } from 'react';
import { Button, Card, Form, Input, Select, Space, Tag, Typography, message } from 'antd';
import { ApiOutlined, PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { aiApi } from '../api';

type Protocol = 'responses' | 'messages';

const { Text, Paragraph } = Typography;

export function AiGatewayPage() {
  const [form] = Form.useForm<{ model: string; protocol: Protocol; prompt: string }>();
  const [models, setModels] = useState<string[]>([]);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const loadConfig = async () => {
    try {
      const config = await aiApi.config();
      setModels(config.models || []);
      setConfigured(Boolean(config.configured));
      form.setFieldsValue({
        model: config.models?.[0] || 'gpt-5.5',
        protocol: 'responses',
        prompt: 'Reply with ok only.',
      });
    } catch (err: any) {
      message.error(err.message || 'Failed to load AI config');
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const runTest = async () => {
    setLoading(true);
    setResult(null);
    try {
      const values = await form.validateFields();
      setResult(await aiApi.test(values));
    } catch (err: any) {
      message.error(err.message || 'AI request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title={
          <Space>
            <ApiOutlined />
            AI Gateway
            <Tag color={configured ? 'success' : 'error'}>
              {configured ? 'Configured' : 'Missing API key'}
            </Tag>
          </Space>
        }
        extra={<Button icon={<ReloadOutlined />} onClick={loadConfig} />}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            model: 'gpt-5.5',
            protocol: 'responses',
            prompt: 'Reply with ok only.',
          }}
        >
          <Form.Item name="protocol" label="Protocol" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'responses', label: 'OpenAI Responses' },
                { value: 'messages', label: 'Anthropic Messages' },
              ]}
            />
          </Form.Item>
          <Form.Item name="model" label="Model" rules={[{ required: true }]}>
            <Select
              showSearch
              options={models.map((model) => ({ value: model, label: model }))}
              dropdownRender={(menu) => (
                <>
                  {menu}
                  <div style={{ padding: 8 }}>
                    <Text type="secondary">You can type any model name supported upstream.</Text>
                  </div>
                </>
              )}
            />
          </Form.Item>
          <Form.Item name="prompt" label="Prompt" rules={[{ required: true }]}>
            <Input.TextArea rows={5} />
          </Form.Item>
          <Button type="primary" icon={<PlayCircleOutlined />} loading={loading} onClick={runTest}>
            Test Request
          </Button>
        </Form>
      </Card>

      {result && (
        <Card
          title={
            <Space>
              Result
              <Tag color={result.ok ? 'success' : 'error'}>{result.status}</Tag>
              <Tag>{result.model}</Tag>
            </Space>
          }
        >
          <Paragraph style={{ whiteSpace: 'pre-wrap' }}>{result.text}</Paragraph>
          <details>
            <summary>Raw response</summary>
            <pre style={{ marginTop: 12, overflow: 'auto' }}>
              {JSON.stringify(result.raw, null, 2)}
            </pre>
          </details>
        </Card>
      )}
    </Space>
  );
}
