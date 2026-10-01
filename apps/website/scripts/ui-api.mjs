// Generate custom API rows from public TypeScript definitions, retaining original types and defaults.
import ts from 'typescript';
import { commonProps } from './ui-antd-api.mjs';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../../../packages/ui/src/', import.meta.url));
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}
const program = ts.createProgram(files(root), {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
});
const checker = program.getTypeChecker();
const descriptions = {
  theme: '宿主解析后的浅色或深色主题。',
  reduceMotion: '减少动态效果，系统偏好由宿主解析后传入。',
  children: '渲染的子内容。',
  label: '可访问名称或展示文案。',
  title: '标题或主文案。',
  description: '辅助说明。',
  count: '数量，0 也会显示。',
  icon: '图标内容或图标名。',
  extra: '额外内容或操作。',
  danger: '危险操作样式。',
  disabled: '禁用操作。',
  onClick: '点击回调，由宿主执行操作。',
  active: '当前激活状态。',
  tooltip: '悬停或聚焦时的说明。',
  className: '附加 CSS 类名。',
  variant: '视觉或内容变体。',
  status: '状态关键字，同时保留文字表达。',
  subtle: '弱化状态外观。',
  path: '文件或目录路径，只读取名称，不访问文件系统。',
  open: '受控开启状态。',
  action: '操作节点。',
  onRetry: '重试回调，状态更新由宿主负责。',
  announce: '是否同时发布反馈。',
  value: '受控值。',
  side: '面板所在方向。',
  expanded: '当前展开状态。',
  controls: '被控制元素的 DOM id。',
  panelName: '面板可访问名称。',
  level: '风险等级：0 普通表单，1 提醒，2 不可撤销。',
  tone: '语义色调。',
  size: '预设尺寸或数字宽度。',
  glyph: '标题图标，false 隐藏。',
  eyebrow: '标题上方的上下文。',
  levelLabel: '风险标签，false 隐藏。',
  hints: '页脚提示，false 隐藏。',
  hintVerb: '默认 Enter 提示中的操作动词。',
  okIcon: '确认按钮图标，false 隐藏。',
  okDisabled: '锁定确认按钮。',
  busyText: '等待状态文案。',
  hideCancel: '隐藏取消按钮。',
  footer: '替换操作行，null 移除整个页脚。',
  acknowledge: '必须勾选的确认说明。',
  typedConfirm: '必须输入的目标文字与匹配说明。',
  body: '正文内边距或滚动方式。',
  initialFocus: '初始焦点目标；默认由风险等级决定。',
  onOk: '确认回调；返回 Promise 时进入等待，拒绝后恢复操作并保留弹窗。关闭由宿主控制。',
  onCancel: '取消回调，宿主更新受控状态。',
  okText: '确认动作文字。',
  hint: '确认提示。',
  onConfirm: '确认回调；Promise 交给 Ant Design 管理等待，拒绝时保留浮层。',
  onOpenChange: '开启状态变化回调，参数为 boolean。',
  placement: '相对触发元素的浮层位置。',
  wide: '使用加宽确认浮层。',
  focus: '初始焦点：确认按钮或 extra 中第一个控件。',
  pad: '添加卡片内部间距。',
  name: '展示名称。',
  off: '弱化统计项。',
  change: '将改变的内容列表。',
  keep: '保留的内容列表。',
  changeTitle: '改变内容的列标题。',
  keepTitle: '保留内容的列标题。',
  role: 'alert/status 时转入反馈；不传时保留静态说明。',
  quiet: '旧兼容属性，当前不会改变行为。',
  plain: '减少确认卡片外观。',
  checked: '受控勾选状态。',
  onChange: '值变化回调，参数与 value/checked 的类型一致。',
  options: '选项及其标题、说明、图标和可用状态。',
  columns: '选项列数。',
  source: '来源标识；与 scope 和 context 一起确定去重身份。',
  type: '反馈语义类型。',
  mode: '反馈意图；当前三种模式均进入已合入的队列。',
  eventKey: '修订标识，同一身份与修订不重复提示。',
  context: '反馈上下文说明。',
  actionLabel: '重试或后续动作的名称。',
  onAction: '动作回调，支持 Promise；重试成功后自动移除反馈。',
  busy: '受控等待状态。',
  actionIcon: '主动作图标。',
  resetOnClear: 'title 清空时是否允许同来源再次提示。',
  content: '富内容。',
  actions: '额外动作节点。',
  message: 'title 的兼容替代。',
  id: '身份或作用域 ID。',
  host: '所属弹窗身份，由上下文管理。',
  scope: '来源作用域。',
  revision: '来源修订，用于去重。',
  lease: '来源租约，用于拒绝过期释放与回调。',
  queued: '是否仍等待展示。',
  at: '该修订首次到达的时间戳。',
  entries: '当前反馈列表。',
  publish: '发布反馈并返回来源租约 number。',
  release: '用 id 与 lease 释放当前来源，过期租约不会覆盖新来源。',
  acknowledge: '将当前修订标为已读，去重记录跨重新挂载保留。',
  rearm: '允许指定来源再次提示。',
  run: '执行当前动作，等待时锁定；成功移除，失败保留并支持重试。',
  updatePresentation: '更新富内容与动作，不重新排队。',
  confirm: '接收 AluneConfirmOptions，返回 Promise<boolean>，确认 true，取消 false。',
  error: '发布错误，弹窗内错误归属当前表单。',
  warning: '发布警告，保留作用域与卸载清理。',
  info: '发布说明。',
  success: '发布成功；高频常规操作应保持克制。',
};
const computedDefaults = {
  AluneModalProps: {
    tone: 'danger 为 true 或 L2 时 danger，否则 default；弹窗反馈可覆盖',
    danger: 'level === 2',
    initialFocus: 'L0: field；L1: ok；L2: cancel',
    levelLabel: 'L2: 不可撤销；其他等级不显示',
    hints: '按 level 生成键盘提示，窄屏隐藏',
    glyph: '不显示',
    okText: '—（宿主提供动作文案）',
    hintVerb: '确认',
  },
};
const api = {};
const definitions = {};
const exportSources = {};
for (const source of program.getSourceFiles().filter((s) => s.fileName.startsWith(root))) {
  const defaults = {};
  for (const node of source.statements)
    if (ts.isFunctionDeclaration(node) && node.name) {
      const parameter = node.parameters[0];
      if (parameter && ts.isObjectBindingPattern(parameter.name)) {
        defaults[node.name.text + 'Props'] = Object.fromEntries(
          parameter.name.elements
            .filter((e) => e.initializer)
            .map((e) => [e.name.getText(source), e.initializer.getText(source)]),
        );
      }
    }
  for (const node of source.statements) {
    if (!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) || !node.name)
      continue;
    if (!ts.isTypeAliasDeclaration(node) && !ts.isInterfaceDeclaration(node)) continue;
    const name = node.name.text;
    let type = checker.getTypeAtLocation(node);
    definitions[name] = node.getText(source);
    if (name === 'FeedbackStore') {
      const state = type.getProperty('getState');
      type = checker.getReturnTypeOfSignature(
        checker.getTypeOfSymbolAtLocation(state, node).getCallSignatures()[0],
      );
    }
    const rows = checker
      .getPropertiesOfType(type)
      .filter((symbol) =>
        symbol.declarations?.some((d) => d.getSourceFile().fileName.startsWith(root)),
      )
      .map((symbol) => {
        const declaration = symbol.valueDeclaration ?? symbol.declarations[0];
        let value = checker.typeToString(
          checker.getTypeOfSymbolAtLocation(symbol, declaration),
          node,
          ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
        );
        const optional = Boolean(symbol.flags & ts.SymbolFlags.Optional);
        if (optional) value = value.replace(/ \| undefined$/, '');
        let description =
          descriptions[symbol.name] ??
          ts.displayPartsToString(symbol.getDocumentationComment(checker)) ??
          '';
        if (
          (name === 'AluneModalProps' || name === 'AluneConfirmOptions') &&
          symbol.name === 'acknowledge'
        )
          description = '必须勾选的确认说明；不传时没有此门槛。';
        if (name === 'DialogProgressProps' && symbol.name === 'value')
          description = '0～1 的进度比例，有限数值会限制在范围内；不传时显示持续等待。';
        if (name === 'DialogNoteProps' && symbol.name === 'icon')
          description = '旧兼容属性，当前静态说明不绘制图标。';
        if (name === 'AluneConfirmOptions' && symbol.name === 'onOk')
          description = '返回 Promise 时等待；成功后确认结果为 true，拒绝时继续停留。';
        if (name === 'FeedbackScopeProps' && symbol.name === 'active')
          description = '与上层作用域共同控制来源有效性；停用后释放来源及过期动作。';
        return {
          name: symbol.name,
          type: value,
          required: !optional,
          default: computedDefaults[name]?.[symbol.name] ?? defaults[name]?.[symbol.name] ?? '—',
          description,
        };
      });
    if (rows.length) api[name] = rows;
  }
}
const entry = program.getSourceFile(join(root, 'index.ts'));
for (const node of entry.statements) {
  if (
    !ts.isExportDeclaration(node) ||
    !node.exportClause ||
    !ts.isNamedExports(node.exportClause) ||
    !node.moduleSpecifier
  )
    continue;
  const from = node.moduleSpecifier.text;
  let source = 'packages/ui/src/index.ts';
  if (from.startsWith('.')) {
    const base = join(root, from);
    const file = program.getSourceFile(base + '.tsx') ?? program.getSourceFile(base + '.ts');
    if (file) source = 'packages/ui/src/' + file.fileName.slice(root.length);
  }
  for (const specifier of node.exportClause.elements)
    exportSources[specifier.name.text] = { source, type: node.isTypeOnly || specifier.isTypeOnly };
}
// Resolve each public Ant Design type through the same entry used by consumers.
const publicTypes = checker.getExportsOfModule(checker.getSymbolAtLocation(entry));
for (const [name, selected] of Object.entries(commonProps)) {
  const exported = publicTypes.find((symbol) => symbol.name === name);
  if (!exported) throw Error(`Missing exported type ${name}`);
  const symbol = checker.getAliasedSymbol(exported);
  const type = checker.getDeclaredTypeOfSymbol(symbol);
  api[name] = Object.entries(selected).map(([property, [defaultValue, description]]) => {
    const prop = type.getProperty(property);
    if (!prop) throw Error(`${name}.${property} no longer exists in Ant Design`);
    const declaration = prop.valueDeclaration ?? prop.declarations[0];
    const optional = Boolean(prop.flags & ts.SymbolFlags.Optional);
    let value = checker.typeToString(
      checker.getTypeOfSymbolAtLocation(prop, declaration),
      entry,
      ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
    );
    if (optional) value = value.replace(/ \| undefined$/, '');
    return { name: property, type: value, required: !optional, default: defaultValue, description };
  });
}
for (const [filename, data] of [
  ['ui-api.json', api],
  ['ui-types.json', definitions],
  ['ui-exports.json', exportSources],
]) {
  const target = new URL('../src/data/' + filename, import.meta.url);
  const result = JSON.stringify(data, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf8') !== result)
      throw Error(filename + ' 已过期，请运行 node apps/website/scripts/ui-api.mjs 并检查文档。');
  } else writeFileSync(target, result);
}
