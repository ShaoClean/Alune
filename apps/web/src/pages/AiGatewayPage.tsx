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
      form.setFieldsValue({ model: nextConfig.models?.[0] || 'gpt-5.5', protocol: 'responses', prompt: '仅回复“ok”。' });
    } catch (err: any) {
      message.error(err.message || '加载 AI 网关配置失败');
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
      message.error(err.message || 'AI 请求失败');
    } finally {
      setLoading(false);
    }
  };

  if (loadingConfig && !config) return <LoadingState label="正在加载 AI 网关配置…" />;

  return (
    <div>
      <div className="page-heading">
        <div><h2>AI 网关</h2><p>无需离开 RemoteGit 工作区，即可测试已配置的上游服务。</p></div>
        <Button icon={<ReloadOutlined />} aria-label="刷新 AI 网关配置" onClick={() => void loadConfig()} loading={loadingConfig}>刷新</Button>
      </div>
      <div className="ai-grid">
        <section className="ai-card">
          <div className="ai-card__header"><div className="ai-card__title"><ApiOutlined /> 网关请求</div><StatusBadge status={config?.configured ? 'connected' : 'error'} label={config?.configured ? '已配置' : '缺少 API 密钥'} /></div>
          <div className="ai-card__body">
            <Form form={form} layout="vertical" initialValues={{ model: 'gpt-5.5', protocol: 'responses', prompt: '仅回复“ok”。' }}>
              <div className="form-grid-2">
                <Form.Item name="protocol" label="协议" rules={[{ required: true }]}><Select options={[{ value: 'responses', label: 'OpenAI Responses' }, { value: 'messages', label: 'Anthropic Messages' }]} /></Form.Item>
                <Form.Item name="model" label="模型" rules={[{ required: true }]}><Select showSearch options={(config?.models || []).map((model) => ({ value: model, label: model }))} dropdownRender={(menu) => <>{menu}<div className="select-help">如果列表中没有目标模型，可直接输入上游模型名称。</div></>} /></Form.Item>
              </div>
              <Form.Item name="prompt" label="提示词" rules={[{ required: true, message: '请输入提示词' }]}><Input.TextArea rows={7} placeholder="输入一条用于验证网关的简短请求。" /></Form.Item>
              <Button type="primary" icon={<PlayCircleOutlined />} loading={loading} onClick={() => void runTest()}>发送测试请求</Button>
            </Form>
          </div>
        </section>
        <div>
          <section className="ai-summary">
            <div><div className="ai-summary__label">上游网关</div><div className="ai-summary__value">{config?.baseUrl || '暂无信息'}</div></div>
            <div><div className="ai-summary__label">API 密钥</div><div className="ai-summary__value"><SafetyCertificateOutlined /> {config?.configured ? '服务器已配置' : '未配置'}</div></div>
            <div><div className="ai-summary__label">支持的模型</div><div className="ai-summary__value">{config?.models?.length || 0} 个可用模型</div></div>
          </section>
          {config?.endpoints && <section className="content-card ai-endpoints"><div className="content-card__header"><h3>网关端点</h3></div><div className="endpoint-list">{Object.entries(config.endpoints).map(([name, endpoint]) => <div className="endpoint-row" key={name}><span>{name}</span><code>{endpoint}</code></div>)}</div></section>}
        </div>
      </div>
      {result ? <section className="ai-result"><div className="ai-result__header"><h3>最新响应</h3><div className="ai-result__meta"><StatusBadge status={result.ok ? 'connected' : 'error'} label={result.ok ? `HTTP ${result.status}` : `HTTP ${result.status || '错误'}`} /><Tag icon={<ClockCircleOutlined />}>{duration !== null ? `${duration} 毫秒` : '—'}</Tag><Tag>{result.protocol} · {result.model}</Tag></div></div><pre className="ai-result__text">{result.text || '无可见文本输出。'}</pre><details className="raw-response"><summary><CheckCircleOutlined /> 上游原始响应</summary><pre>{JSON.stringify(result.raw, null, 2)}</pre></details></section> : <div className="content-card"><EmptyState title="尚未发起请求" description="发送测试请求以查看上游响应、耗时和原始数据。" /></div>}
    </div>
  );
}
