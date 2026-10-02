import { parse, type ParseError } from 'jsonc-parser';

export type CodeThemeMode = 'light' | 'dark';
export const TOKEN_GROUPS = [
  'comment',
  'keyword',
  'string',
  'number',
  'constant',
  'function',
  'type',
  'tag',
  'property',
  'regex',
  'variable',
  'punctuation',
  'operator',
  'inserted',
  'deleted',
] as const;
export type TokenGroup = (typeof TOKEN_GROUPS)[number];
export interface TokenStyle {
  color: string;
  italic: boolean;
  bold: boolean;
  underline: boolean;
  strikethrough: boolean;
}
export const DIFF_COLOR_KEYS = {
  'diffEditor.insertedLineBackground': 'added',
  'diffEditor.removedLineBackground': 'removed',
  'diffEditor.insertedTextBackground': 'wordAdded',
  'diffEditor.removedTextBackground': 'wordRemoved',
} as const;
export type DiffColor = (typeof DIFF_COLOR_KEYS)[keyof typeof DIFF_COLOR_KEYS];

export interface CodeTheme {
  id: string;
  name: string;
  mode: CodeThemeMode;
  source: string;
  colors: {
    background: string;
    foreground: string;
    gutter: string;
    lineNumber: string;
    selection: string;
  };
  diff?: Partial<Record<DiffColor, string>>;
  tokens: Record<TokenGroup, TokenStyle>;
}

const tokenStyle = (color: string): TokenStyle => ({
  color,
  italic: false,
  bold: false,
  underline: false,
  strikethrough: false,
});

// Official Catppuccin palette, mapped to the token groups emitted by Prism.
// https://github.com/catppuccin/palette (MIT; see public/assets/code-themes-NOTICE.txt).
const palettes = [
  {
    id: 'latte',
    name: 'Latte',
    mode: 'light',
    base: '#eff1f5',
    text: '#4c4f69',
    overlay: '#7c7f93',
    surface: '#ccd0da',
    mauve: '#8839ef',
    green: '#40a02b',
    peach: '#fe640b',
    blue: '#1e66f5',
    yellow: '#df8e1d',
    red: '#d20f39',
    teal: '#179299',
    lavender: '#7287fd',
    pink: '#ea76cb',
  },
  {
    id: 'frappe',
    name: 'Frappé',
    mode: 'dark',
    base: '#303446',
    text: '#c6d0f5',
    overlay: '#838ba7',
    surface: '#51576d',
    mauve: '#ca9ee6',
    green: '#a6d189',
    peach: '#ef9f76',
    blue: '#8caaee',
    yellow: '#e5c890',
    red: '#e78284',
    teal: '#81c8be',
    lavender: '#babbf1',
    pink: '#f4b8e4',
  },
  {
    id: 'macchiato',
    name: 'Macchiato',
    mode: 'dark',
    base: '#24273a',
    text: '#cad3f5',
    overlay: '#8087a2',
    surface: '#494d64',
    mauve: '#c6a0f6',
    green: '#a6da95',
    peach: '#f5a97f',
    blue: '#8aadf4',
    yellow: '#eed49f',
    red: '#ed8796',
    teal: '#8bd5ca',
    lavender: '#b7bdf8',
    pink: '#f5bde6',
  },
  {
    id: 'mocha',
    name: 'Mocha',
    mode: 'dark',
    base: '#1e1e2e',
    text: '#cdd6f4',
    overlay: '#7f849c',
    surface: '#45475a',
    mauve: '#cba6f7',
    green: '#a6e3a1',
    peach: '#fab387',
    blue: '#89b4fa',
    yellow: '#f9e2af',
    red: '#f38ba8',
    teal: '#94e2d5',
    lavender: '#b4befe',
    pink: '#f5c2e7',
  },
] as const;

export const BUILTIN_CODE_THEMES: readonly CodeTheme[] = palettes.map((p) => ({
  id: `catppuccin-${p.id}`,
  name: `Catppuccin ${p.name}`,
  mode: p.mode,
  source: '内置 · Catppuccin',
  colors: {
    background: p.base,
    foreground: p.text,
    gutter: p.base,
    lineNumber: p.overlay,
    selection: p.surface,
  },
  tokens: {
    comment: { ...tokenStyle(p.overlay), italic: true },
    keyword: tokenStyle(p.mauve),
    string: tokenStyle(p.green),
    number: tokenStyle(p.peach),
    constant: tokenStyle(p.peach),
    function: tokenStyle(p.blue),
    type: tokenStyle(p.yellow),
    tag: tokenStyle(p.blue),
    property: tokenStyle(p.lavender),
    regex: tokenStyle(p.pink),
    variable: tokenStyle(p.text),
    punctuation: tokenStyle(p.overlay),
    operator: tokenStyle(p.teal),
    inserted: tokenStyle(p.green),
    deleted: tokenStyle(p.red),
  },
}));

export const DEFAULT_CODE_THEME_IDS = { light: 'catppuccin-latte', dark: 'catppuccin-mocha' };
export const defaultCodeTheme = (mode: CodeThemeMode): CodeTheme =>
  BUILTIN_CODE_THEMES.find((theme) => theme.id === DEFAULT_CODE_THEME_IDS[mode])!;

export const MAX_THEME_BYTES = 1024 * 1024;
export const MAX_CUSTOM_THEMES = 32;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const isThemeColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value);
const validLabel = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= 160 &&
  !/[\x00-\x1f]/.test(value);

// A deliberately bounded compatibility layer, not a TextMate selector engine.
// A simple scope maps to one Prism group; longest known prefix wins. Contextual
// selectors and semanticTokenColors are not applied. Language suffixes flatten
// to the same group, so e.g. keyword.control.python colors Prism keywords.
const scopeGroups: Array<[string, TokenGroup]> = [
  ['comment', 'comment'],
  ['punctuation.definition.comment', 'comment'],
  ['keyword', 'keyword'],
  ['storage', 'keyword'],
  ['keyword.operator', 'operator'],
  ['string', 'string'],
  ['string.regexp', 'regex'],
  ['constant.character.escape', 'regex'],
  ['constant', 'constant'],
  ['constant.numeric', 'number'],
  ['entity.name.function', 'function'],
  ['support.function', 'function'],
  ['entity.name.type', 'type'],
  ['entity.name.class', 'type'],
  ['entity.other.inherited-class', 'type'],
  ['support.type', 'type'],
  ['support.class', 'type'],
  ['entity.name.tag', 'tag'],
  ['entity.other.attribute-name', 'property'],
  ['support.type.property-name', 'property'],
  ['variable.other.property', 'property'],
  ['meta.object-literal.key', 'property'],
  ['variable', 'variable'],
  ['punctuation', 'punctuation'],
  ['markup.inserted', 'inserted'],
  ['markup.deleted', 'deleted'],
].sort((a, b) => b[0].length - a[0].length) as Array<[string, TokenGroup]>;

const prismGroups: Record<string, TokenGroup> = {
  comment: 'comment',
  prolog: 'comment',
  doctype: 'comment',
  cdata: 'comment',
  keyword: 'keyword',
  atrule: 'keyword',
  important: 'keyword',
  string: 'string',
  char: 'string',
  'attr-value': 'string',
  number: 'number',
  boolean: 'constant',
  constant: 'constant',
  symbol: 'constant',
  function: 'function',
  'function-variable': 'function',
  'class-name': 'type',
  builtin: 'type',
  selector: 'tag',
  tag: 'tag',
  title: 'tag',
  property: 'property',
  'attr-name': 'property',
  regex: 'regex',
  variable: 'variable',
  punctuation: 'punctuation',
  operator: 'operator',
  inserted: 'inserted',
  deleted: 'deleted',
};

// CSS variable references keep token DOM unchanged when theme/font preferences change.
export function prismTokenStyle(type: string, aliases: string[]) {
  const group = [type, ...aliases].map((name) => prismGroups[name]).find(Boolean);
  if (!group) return undefined;
  return {
    color: `var(--syntax-${group})`,
    fontStyle: `var(--syntax-${group}-style)`,
    fontWeight: `var(--syntax-${group}-weight)`,
    textDecoration: `var(--syntax-${group}-decoration)`,
  };
}

export function importCodeTheme(
  text: string,
  filename: string,
  id: string,
): { theme: CodeTheme; ignoredRules: number } {
  if (new TextEncoder().encode(text).length > MAX_THEME_BYTES)
    throw new Error('主题文件不能超过 1 MB。');
  const errors: ParseError[] = [];
  const value: unknown = parse(text.replace(/^\uFEFF/, ''), errors, { allowTrailingComma: true });
  if (errors.length || !isRecord(value))
    throw new Error('主题格式无效，请选择 VS Code Color Theme JSON 文件。');
  if (value.type !== 'light' && value.type !== 'dark')
    throw new Error('主题必须声明 type 为 light 或 dark，才能匹配 Alune 外观。');
  if (value.include !== undefined)
    throw new Error('暂不支持 include 引用，请导入合并依赖后的独立主题文件。');
  if (!Array.isArray(value.tokenColors))
    throw new Error('主题必须包含 tokenColors 数组，不能引用外部配色文件。');
  if (value.colors !== undefined && !isRecord(value.colors))
    throw new Error('主题 colors 必须是颜色对象。');
  const name = value.name ?? filename.replace(/\.(jsonc?|code-theme)$/i, '');
  if (!validLabel(name) || !validLabel(filename))
    throw new Error('主题名称或文件名无效（最多 160 个字符）。');
  const base = defaultCodeTheme(value.type);
  const theme: CodeTheme = {
    ...base,
    id,
    name: name.trim(),
    source: filename,
    colors: { ...base.colors },
    tokens: structuredClone(base.tokens),
  };
  const colors = value.colors ?? {};
  const colorKeys = {
    'editor.background': 'background',
    'editor.foreground': 'foreground',
    'editorGutter.background': 'gutter',
    'editorLineNumber.foreground': 'lineNumber',
    'editor.selectionBackground': 'selection',
  } as const;
  for (const [key, target] of Object.entries(colorKeys)) {
    if (colors[key] === undefined) continue;
    if (!isThemeColor(colors[key])) throw new Error(`${key} 需要使用十六进制颜色（如 #1e1e2e）。`);
    theme.colors[target] = colors[key];
  }
  for (const [key, target] of Object.entries(DIFF_COLOR_KEYS)) {
    if (colors[key] === undefined) continue;
    if (!isThemeColor(colors[key])) throw new Error(`${key} 需要使用十六进制颜色。`);
    (theme.diff ??= {})[target] = colors[key];
  }
  theme.colors.gutter =
    (colors['editorGutter.background'] as string | undefined) ?? theme.colors.background;
  let ignoredRules = value.semanticTokenColors === undefined ? 0 : 1;
  let mappedColors = 0;
  const scores = new Map<string, number>();
  for (const rule of value.tokenColors) {
    if (!isRecord(rule) || !isRecord(rule.settings))
      throw new Error('tokenColors 中的每条规则必须包含 settings 对象。');
    const { foreground, fontStyle } = rule.settings;
    if (foreground !== undefined && !isThemeColor(foreground))
      throw new Error('语法前景色需要使用十六进制颜色。');
    if (
      fontStyle !== undefined &&
      (typeof fontStyle !== 'string' ||
        fontStyle
          .trim()
          .split(/\s+/)
          .some((style) => !['', 'italic', 'bold', 'underline', 'strikethrough'].includes(style)))
    )
      throw new Error('语法 fontStyle 仅支持 italic、bold、underline 和 strikethrough。');
    if (rule.scope === undefined || rule.scope === '') {
      if (foreground && colors['editor.foreground'] === undefined)
        theme.colors.foreground = foreground;
      continue;
    }
    const scopes = typeof rule.scope === 'string' ? [rule.scope] : rule.scope;
    if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== 'string'))
      throw new Error('语法 scope 必须是字符串或字符串数组。');
    for (const scope of scopes.flatMap((scope: string) =>
      scope.split(',').map((part) => part.trim()),
    )) {
      const match =
        /^[\w-]+(?:\.[\w-]+)*$/.test(scope) &&
        scopeGroups.find(([prefix]) => scope === prefix || scope.startsWith(`${prefix}.`));
      if (!match) {
        ignoredRules++;
        continue;
      }
      const [prefix, group] = match;
      const score = prefix.length;
      const style = theme.tokens[group];
      if (foreground !== undefined) {
        mappedColors++;
        if (score >= (scores.get(`${group}:color`) ?? -1)) {
          style.color = foreground;
          scores.set(`${group}:color`, score);
        }
      }
      if (fontStyle !== undefined && score >= (scores.get(`${group}:style`) ?? -1)) {
        for (const key of ['italic', 'bold', 'underline', 'strikethrough'] as const)
          style[key] = fontStyle.split(/\s+/).includes(key);
        scores.set(`${group}:style`, score);
      }
    }
  }
  if (!mappedColors)
    throw new Error(
      '未找到可应用的语法颜色，请使用包含常见 tokenColors scope（如 keyword、string）的主题。',
    );
  return { theme, ignoredRules };
}

// Stored custom themes contain normalized data only; never CSS or external URLs.
export function readCustomCodeTheme(value: unknown): CodeTheme | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !/^custom-[\w-]{1,80}$/.test(value.id) ||
    !validLabel(value.name) ||
    !validLabel(value.source) ||
    (value.mode !== 'light' && value.mode !== 'dark') ||
    !isRecord(value.colors) ||
    !isRecord(value.tokens)
  )
    return null;
  const colors = Object.fromEntries(
    Object.keys(defaultCodeTheme(value.mode).colors).map((key) => [
      key,
      value.colors && (value.colors as Record<string, unknown>)[key],
    ]),
  );
  if (!Object.values(colors).every(isThemeColor)) return null;
  const diff: CodeTheme['diff'] = {};
  if (value.diff !== undefined) {
    if (!isRecord(value.diff)) return null;
    for (const key of Object.values(DIFF_COLOR_KEYS)) {
      if (value.diff[key] === undefined) continue;
      if (!isThemeColor(value.diff[key])) return null;
      diff[key] = value.diff[key];
    }
  }
  const tokens: Partial<Record<TokenGroup, TokenStyle>> = {};
  for (const group of TOKEN_GROUPS) {
    const style = value.tokens[group];
    if (
      !isRecord(style) ||
      !isThemeColor(style.color) ||
      ['italic', 'bold', 'underline', 'strikethrough'].some(
        (key) => typeof style[key] !== 'boolean',
      )
    )
      return null;
    tokens[group] = {
      color: style.color,
      italic: style.italic as boolean,
      bold: style.bold as boolean,
      underline: style.underline as boolean,
      strikethrough: style.strikethrough as boolean,
    };
  }
  return {
    id: value.id,
    name: value.name,
    source: value.source,
    mode: value.mode,
    colors: colors as CodeTheme['colors'],
    ...(value.diff !== undefined ? { diff } : {}),
    tokens: tokens as CodeTheme['tokens'],
  };
}
