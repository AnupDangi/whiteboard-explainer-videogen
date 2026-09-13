/** Single source of truth for the planner's visual vocabulary, shared by the LLM-facing
 *  schema, the fixture/model validator, the renderer's icon lookup and the prompt text —
 *  so the three layers can never drift out of sync with each other. */
export const NODE_KINDS=[
  'generic','question','key','container','database','model','user','document','api','cloud',
  'memory','search','vector','token','brain','lock','warning','success','graph',
  // Computing / AI
  'matrix','agent','server','file','image','request','response',
  // Learning
  'idea','teacher','student','book','example','result',
  // Math / science
  'equation','probability','atom','cell','energy',
  // General process
  'input','process','output','loop','choice',
  // Forces and opposition (distinct glyphs so antonyms never share an icon)
  'attract','repel',
  // Objects and measures
  'note','tool','cycle','light','temperature','molecule',
  // Objects and systems (icon + full illustration each)
  'plant','sun','browser','phone','robot','pipeline',
] as const;
export type NodeKind=typeof NODE_KINDS[number];
export const LAYOUTS=['flow','branch','compare','hierarchy','timeline','radial','convergence'] as const;
export type LayoutName=typeof LAYOUTS[number];
