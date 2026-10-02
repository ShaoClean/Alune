import { FeedbackNotice } from '@alune/ui';
import { useRef, useState } from 'react';
import { Button, Input, InputNumber, Select } from '@alune/ui';
import { useAppearance } from '../../appearance';
import { BUILTIN_CODE_THEMES, MAX_THEME_BYTES } from '../../code-themes';
import {
  DEFAULT_CODE_FONT,
  MIN_CODE_FONT_SIZE,
  MAX_CODE_FONT_SIZE,
  resolveCodeTheme,
} from '../../stores/codeAppearance';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { CodeView } from '../CodeView';
import { fileLanguage } from '../file-language';

const examples = {
  'example.ts': {
    label: 'TypeScript',
    text: '// 欢迎使用 Alune\ninterface Repository { name: string; local: boolean }\n\nexport function greet(repo: Repository): string {\n  const count = 42;\n  return `Hello, ${repo.name}! (${count})`;\n}',
  },
  'example.py': {
    label: 'Python',
    text: '# 欢迎使用 Alune\nfrom dataclasses import dataclass\n\n@dataclass\nclass Repository:\n    name: str = "alune"\n    local: bool = True\n\nprint(Repository(), 42)',
  },
  'example.json': {
    label: 'JSON',
    text: '{\n  "name": "Alune",\n  "local": true,\n  "repositories": 42,\n  "themes": ["Latte", "Mocha"],\n  "remote": null\n}',
  },
};

export function CodeAppearanceSettings() {
  const mode = useAppearance((state) => state.theme);
  const {
    codeAppearance: preferences,
    codeAppearanceNotice,
    dismissCodeAppearanceNotice,
    selectCodeTheme,
    importCodeTheme,
    removeCodeTheme,
    updateCodeFont,
    resetCodeAppearance,
  } = useWorkspaceStore();
  const [fontDraft, setFontDraft] = useState(preferences.fontFamily);
  const [example, setExample] = useState<keyof typeof examples>('example.ts');
  const [feedback, setFeedback] = useState<{ type: 'warning' | 'error'; text: string } | null>(
    null,
  );
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const theme = resolveCodeTheme(preferences, mode);
  const modeLabel = mode === 'dark' ? '深色' : '浅色';
  const sample = examples[example];

  async function install(file: File) {
    setImporting(true);
    setFeedback(null);
    try {
      if (file.size > MAX_THEME_BYTES) throw new Error('主题文件不能超过 1 MB。');
      const result = importCodeTheme(await file.text(), file.name);
      if (result.ignoredRules)
        setFeedback({
          type: 'warning',
          text: `已安装「${result.name}」，但部分配色规则不在支持范围内，预览以实际显示为准。`,
        });
    } catch (error) {
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : '无法读取主题文件，请重试。',
      });
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="code-appearance-settings" aria-labelledby="code-appearance-heading">
      <div className="settings-section-heading">
        <h2 id="code-appearance-heading">代码阅读</h2>
        <Button
          size="small"
          onClick={() => {
            resetCodeAppearance();
            setFontDraft(DEFAULT_CODE_FONT);
            setFeedback(null);
          }}
        >
          恢复代码默认设置
        </Button>
      </div>
      <p className="settings-field-hint">
        应用于本地与 SSH 仓库的文件阅读，修改即时生效并保存在本设备。
      </p>
      <FeedbackNotice
        source="code-appearance-recovery"
        title={codeAppearanceNotice ? '代码外观配置已恢复' : null}
        description={codeAppearanceNotice || undefined}
        type="warning"
        mode="notification"
        actionLabel="知道了"
        onAction={dismissCodeAppearanceNotice}
      />
      <label htmlFor="code-theme" className="settings-field">
        代码主题
        <Select
          id="code-theme"
          aria-label="代码主题"
          aria-describedby="code-theme-mode-hint"
          value={theme.id}
          onChange={(value) => selectCodeTheme(mode, value)}
          options={[
            {
              label: '内置主题',
              options: BUILTIN_CODE_THEMES.map((item) => ({
                value: item.id,
                disabled: item.mode !== mode,
                label: `${item.name} · ${item.mode === 'dark' ? '深色' : '浅色'}${item.mode !== mode ? '（与当前外观不匹配）' : ''}`,
              })),
            },
            ...(preferences.customThemes.length
              ? [
                  {
                    label: '已安装主题',
                    options: preferences.customThemes.map((item) => ({
                      value: item.id,
                      disabled: item.mode !== mode,
                      label: `${item.name} · ${item.mode === 'dark' ? '深色' : '浅色'}${item.mode !== mode ? '（与当前外观不匹配）' : ''}`,
                    })),
                  },
                ]
              : []),
          ]}
        />
      </label>
      <p id="code-theme-mode-hint" className="settings-field-hint">
        当前 Alune 为{modeLabel}外观，仅可选择{modeLabel}代码主题。浅色与深色分别记住上次选择。
      </p>
      <div className="settings-form-row code-font-row">
        <label className="settings-field" htmlFor="code-font-family">
          代码字体
          <Input
            id="code-font-family"
            list="code-font-suggestions"
            value={fontDraft}
            maxLength={100}
            placeholder={DEFAULT_CODE_FONT}
            onChange={(event) => {
              setFontDraft(event.target.value);
              updateCodeFont({ fontFamily: event.target.value });
            }}
            onBlur={() => setFontDraft(preferences.fontFamily)}
          />
          <datalist id="code-font-suggestions">
            {[
              'SFMono-Regular',
              'Consolas',
              'Menlo',
              'JetBrains Mono',
              'Fira Code',
              'Cascadia Code',
              'Source Code Pro',
            ].map((font) => (
              <option key={font} value={font} />
            ))}
          </datalist>
        </label>
        <label className="settings-field" htmlFor="code-font-size">
          字号（px）
          <InputNumber
            id="code-font-size"
            min={MIN_CODE_FONT_SIZE}
            max={MAX_CODE_FONT_SIZE}
            precision={0}
            value={preferences.fontSize}
            onChange={(fontSize) => {
              if (fontSize !== null) updateCodeFont({ fontSize });
            }}
          />
        </label>
      </div>
      <p className="settings-field-hint">
        填写一个本机已安装的字体名称；字体不可用时自动使用系统等宽字体。恢复默认不会卸载已导入主题。
      </p>
      <div className="code-appearance-preview">
        <div className="code-appearance-preview__header">
          <span>代码预览 · {theme.name}</span>
          <label htmlFor="code-example-language">
            示例语言{' '}
            <Select
              id="code-example-language"
              aria-label="示例语言"
              value={example}
              onChange={(value) => setExample(value)}
              options={Object.entries(examples).map(([path, item]) => ({
                value: path,
                label: item.label,
              }))}
            />
          </label>
        </div>
        <CodeView
          showNotice={false}
          path={example}
          text={sample.text}
          lines={sample.text.split('\n').length}
          language={fileLanguage(example)}
        />
      </div>
      <div className="settings-section-heading code-theme-install-heading">
        <h2>自定义主题</h2>
        <Button size="small" loading={importing} onClick={() => fileInput.current?.click()}>
          导入主题 JSON
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,.jsonc,application/json"
          aria-label="导入代码主题文件"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void install(file);
          }}
        />
      </div>
      <p className="settings-field-hint">
        支持独立的 VS Code Color Theme JSON / JSONC（最多 1
        MB），需要声明浅色或深色类型。安装后可在上方选择主题。
      </p>
      {feedback && (
        <FeedbackNotice
          source="code-theme-import"
          type={feedback.type}
          title={feedback.type === 'error' ? '主题导入失败' : feedback.text}
          description={feedback.text}
          eventKey={feedback}
        />
      )}
      {preferences.customThemes.length ? (
        <ul className="code-theme-list">
          {preferences.customThemes.map((item) => (
            <li key={item.id}>
              <span
                className="code-theme-swatch"
                aria-hidden="true"
                style={{ background: item.colors.background, color: item.tokens.keyword.color }}
              >
                Aa
              </span>
              <div className="code-theme-list__copy">
                <strong>{item.name}</strong>
                <span>
                  来源：{item.source} · {item.mode === 'dark' ? '深色' : '浅色'}
                  {item.id === theme.id
                    ? ' · 使用中'
                    : item.mode !== mode
                      ? ' · 切换外观后可用'
                      : ''}
                </span>
              </div>
              <Button
                size="small"
                aria-label={`卸载 ${item.name}`}
                onClick={() => {
                  removeCodeTheme(item.id);
                  setFeedback(null);
                }}
              >
                卸载
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="settings-field-hint">尚未安装自定义主题，四款 Catppuccin 已内置。</p>
      )}
      <details className="code-theme-compatibility">
        <summary>主题兼容范围</summary>
        <p>
          读取代码背景、前景、行号、选区，以及 tokenColors
          中常见的注释、关键字、字符串、数字、函数等颜色和字形。简单 scope 按前缀映射到 Prism
          语法类别，同类别在各语言中使用相同配色；缺少的颜色沿用对应 Catppuccin 默认值。预览可能与
          VS Code 有差异。
        </p>
        <p>
          支持注释和尾随逗号。不支持 .vsix、主题市场、include 外部文件、TextMate
          上下文选择器或语义高亮规则。
        </p>
      </details>
    </section>
  );
}
