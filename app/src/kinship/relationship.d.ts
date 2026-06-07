// relationship.js ships no TypeScript types. Minimal ambient declaration for
// the parts we use (type:'default' returns an array of candidate 称谓 strings).
declare module 'relationship.js' {
  interface RelationshipOptions {
    text: string;          // target's chain, base words joined by 的 (e.g. 爸爸的哥哥)
    target?: string;       // reference person's chain; '' = self
    sex?: number;          // self's sex: 0 female, 1 male
    type?: 'default' | 'chain' | 'pair';
    reverse?: boolean;
    mode?: string;
  }
  // For type:'default' the call returns an array of candidate terms.
  function relationship(options: RelationshipOptions): string[];
  export default relationship;
}
