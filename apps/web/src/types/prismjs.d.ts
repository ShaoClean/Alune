// prismjs ships without types; only the tokenizer API used by the file preview is declared.
declare module 'prismjs/components/prism-core.js' {
  export interface PrismToken {
    type: string;
    content: string | PrismToken | Array<string | PrismToken>;
    alias?: string | string[];
  }
  export type PrismGrammar = Record<string, unknown>;
  const Prism: {
    languages: Record<string, PrismGrammar | undefined>;
    tokenize(text: string, grammar: PrismGrammar): Array<string | PrismToken>;
  };
  export default Prism;
}
declare module 'prismjs/components/*';
