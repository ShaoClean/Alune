export interface ExampleDefinition {
  id: string;
  title: string;
  height: number;
}
export const examples: ExampleDefinition[] = [
  {
    id: 'button',
    title: '按钮',
    height: 380,
  },
  {
    id: 'confirm',
    title: '异步确认',
    height: 720,
  },
  {
    id: 'dialog-parts',
    title: '弹窗内容组合',
    height: 780,
  },
  {
    id: 'dropdown',
    title: '菜单',
    height: 380,
  },
  {
    id: 'empty',
    title: '空内容',
    height: 380,
  },
  {
    id: 'feedback-store',
    title: '反馈状态源',
    height: 380,
  },
  {
    id: 'feedback',
    title: '作用域与反馈',
    height: 720,
  },
  {
    id: 'form',
    title: '表单',
    height: 380,
  },
  {
    id: 'icons',
    title: '文件图标',
    height: 380,
  },
  {
    id: 'input-number',
    title: '数字输入',
    height: 380,
  },
  {
    id: 'input',
    title: '输入框',
    height: 380,
  },
  {
    id: 'modal',
    title: '分级弹窗',
    height: 720,
  },
  {
    id: 'pagination',
    title: '分页',
    height: 380,
  },
  {
    id: 'panels',
    title: '面板标题',
    height: 380,
  },
  {
    id: 'popconfirm',
    title: '锚定确认',
    height: 720,
  },
  {
    id: 'popover',
    title: '浮层',
    height: 380,
  },
  {
    id: 'progress',
    title: '进度',
    height: 380,
  },
  {
    id: 'provider',
    title: '主题与运行时上下文',
    height: 380,
  },
  {
    id: 'radio',
    title: '单选',
    height: 380,
  },
  {
    id: 'result',
    title: '结果',
    height: 380,
  },
  {
    id: 'segmented',
    title: '分段选择',
    height: 380,
  },
  {
    id: 'select',
    title: '选择器',
    height: 380,
  },
  {
    id: 'space',
    title: '间距',
    height: 380,
  },
  {
    id: 'spin',
    title: '加载',
    height: 380,
  },
  {
    id: 'states',
    title: '语义状态',
    height: 980,
  },
  {
    id: 'switch',
    title: '开关',
    height: 380,
  },
  {
    id: 'tabs',
    title: '页签',
    height: 380,
  },
  {
    id: 'tag',
    title: '标签',
    height: 380,
  },
  {
    id: 'toolbar',
    title: '工具栏按钮',
    height: 380,
  },
  {
    id: 'tooltip',
    title: '提示',
    height: 380,
  },
  {
    id: 'typography',
    title: '文字',
    height: 380,
  },
];
export const exampleSources = import.meta.glob<string>(['./*.tsx', '!./DemoRoot.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
export const sourceFor = (id: string) => exampleSources[`./${id}.tsx`];
