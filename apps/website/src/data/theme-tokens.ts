import tokens from '../../../../packages/ui/src/styles/tokens.css?raw';
const darkRule = /:root\[data-theme='dark'\]\s*\{([\s\S]*?)\}/.exec(tokens)!;
const parse = (text: string) =>
  Object.fromEntries(
    [...text.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]),
  );
export const light = parse(tokens.slice(0, darkRule.index));
export const dark = { ...light, ...parse(darkRule[1]) };
export const darkDeclarations = darkRule[1];
