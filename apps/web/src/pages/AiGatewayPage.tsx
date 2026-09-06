import { useEffect, useState } from 'react';
import { Button, Form, Input, Select, Tag, message } from 'antd';
import { ApiOutlined, CheckCircleOutlined, ClockCircleOutlined, PlayCircleOutlined, ReloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { aiApi } from '../api';
import { EmptyState, LoadingState, StatusBadge } from '../components/ui';

type Protocol = 'responses' | 'messages';
type Config = { baseUrl?: string; configured?: boolean; models?: string[]; endpoints?: Record<string, string> };

export function AiGatewayPage() {
  const [form] = Form.useForm<{ model: string; protocol: Protocol; prompt: string }>();
  const [config, setConfig] = useState<Config | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [duration, setDuration] = useState<number | null>(null);

  const loadConfig = async () => {
    setLoadingConfig(true);
    try {
      const nextConfig = await aiApi.config();
      setConfig(nextConfig);
      form.setFieldsValue({ model: nextConfig.models?.[0] || 'gpt-5.5', protocol: 'responses', prompt: 'Reply with ok only.' });
    } catch (err: any) {
      message.error(err.message || 'Failed to load AI gateway config');
    } finally {
      setLoadingConfig(false);
    }
  };

  useEffect(() => {
    void loadConfig();
  }, []);

  const runTest = async () => {
    setLoading(true);
    setResult(null);
    const startedAt = Date.now();
    try {
      const values = await form.validateFields();
      setResult(await aiApi.test(values));
      setDuration(Date.now() - startedAt);
    } catch (err: any) {
      message.error(err.message || 'AI request failed');
    } finally {
      setLoading(false);
    }
  };

  if (loadingConfig && !config) return <LoadingState label="Loading AI gateway configuration…" />;

  return (
    <div>
      <div className="page-heading">
        <div><h2>AI Gateway</h2><p>Test the configured upstream without leaving your RemoteGit workspace.</p></div>
        <Button icon={<ReloadOutlined />} aria-label="Refresh AI gateway configuration" onClick={() => void loadConfig()} loading={loadingConfig}>Refresh</Button>
      </div>
      <div className="ai-grid">
        <section className="ai-card">
          <div className="ai-card__header"><div className="ai-card__title"><ApiOutlined /> Gateway request</div><StatusBadge status={config?.configured ? 'connected' : 'error'} label={config?.configured ? 'Configured' : 'Missing API key'} /></div>
          <div className="ai-card__body">
            <Form form={form} layout="vertical" initialValues={{ model: 'gpt-5.5', protocol: 'responses', prompt: 'Reply with ok only.' }}>
              <div className="form-grid-2">
                <Form.Item name="protocol" label="Protocol" rules={[{ required: true }]}><Select options={[{ value: 'responses', label: 'OpenAI Responses' }, { value: 'messages', label: 'Anthropic Messages' }]} /></Form.Item>
                <Form.Item name="model" label="Model" rules={[{ required: true }]}><Select showSearch options={(config?.models || []).map((model) => ({ value: model, label: model }))} dropdownRender={(menu) => <>{menu}<div className="select-help">Type any upstream model name if it is not listed.</div></>} /></Form.Item>
              </div>
              <Form.Item name="prompt" label="Prompt" rules={[{ required: true, message: 'Enter a prompt' }]}><Input.TextArea rows={7} placeholder="Write a small request to verify the gateway." /></Form.Item>
              <Button type="primary" icon={<PlayCircleOutlined />} loading={loading} onClick={() => void runTest()}>Send test request</Button>
            </Form>
          </div>
        </section>
        <div>
          <section className="ai-summary">
            <div><div className="ai-summary__label">Upstream gateway</div><div className="ai-summary__value">{config?.baseUrl || 'Not available'}</div></div>
            <div><div className="ai-summary__label">API key</div><div className="ai-summary__value"><SafetyCertificateOutlined /> {config?.configured ? 'Configured on server' : 'Not configured'}</div></div>
            <div><div className="ai-summary__label">Supported models</div><div className="ai-summary__value">{config?.models?.length || 0} models available</div></div>
          </section>
          {config?.endpoints && <section className="content-card ai-endpoints"><div className="content-card__header"><h3>Gateway endpoints</h3></div><div className="endpoint-list">{Object.entries(config.endpoints).map(([name, endpoint]) => <div className="endpoint-row" key={name}><span>{name}</span><code>{endpoint}</code></div>)}</div></section>}
        </div>
      </div>
      {result ? <section className="ai-result"><div className="ai-result__header"><h3>Latest response</h3><div className="ai-result__meta"><StatusBadge status={result.ok ? 'connected' : 'error'} label={result.ok ? `HTTP ${result.status}` : `HTTP ${result.status || 'error'}`} /><Tag icon={<ClockCircleOutlined />}>{duration !== null ? `${duration} ms` : '—'}</Tag><Tag>{result.protocol} · {result.model}</Tag></div></div><pre className="ai-result__text">{result.text || 'No visible text output.'}</pre><details className="raw-response"><summary><CheckCircleOutlined /> Raw upstream response</summary><pre>{JSON.stringify(result.raw, null, 2)}</pre></details></section> : <div className="content-card"><EmptyState title="No request yet" description="Send a test request to inspect the upstream response, timing, and raw payload." /></div>}
    </div>
  );
}
