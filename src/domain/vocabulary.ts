
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
  // Domain richness: nature, biology, anatomy, science, history (icon + some illustration)
  'leaf','flower','seed','water','co2','tree','heart','lung','neuron','dna','magnet','globe','scroll','scale','battery',
] as const;
export type NodeKind=typeof NODE_KINDS[number];
export const LAYOUTS=['flow','branch','compare','hierarchy','timeline','radial','convergence'] as const;
export type LayoutName=typeof LAYOUTS[number];

/** Central semantic lexicon for deterministic kind resolution — the single source of
 *  truth shared by the prompt vocabulary and `resolveKind`. Concrete nouns only, never
 *  vague words, so a genuinely unclassifiable label still resolves to nothing (generic).
 *  Multi-word entries match as phrases. */
export const KIND_KEYWORDS:Partial<Record<NodeKind,readonly string[]>>={
  // Core system/lesson vocabulary. This is the single deterministic lexicon used by
  // auto-direction, so there is no second regex table that can drift from the schema.
  user:['user','customer','person','people','viewer'],
  database:['database','datastore','storage','store'],
  token:['token','tokens'],
  model:['model','neural network','transformer','llm','moe','network','layer'],
  server:['server','backend','host','gpu','gpus','hardware'],
  api:['api','interface','endpoint'],
  cloud:['cloud'],
  memory:['cache','memory','buffer','kv cache'],
  search:['search','retrieval','retrieve'],
  vector:['vector','embedding','embeddings'],
  key:['key','credential'],
  document:['document','file','paper'],
  lock:['lock','security','encrypt','encryption','multi factor','mfa','password','account takeover','lawful reporting'],
  warning:['warning','risk','failure','danger'],
  success:['success','win','best','outperform','efficiency','performance','throughput','speed','faster','optimization','optimize'],
  graph:['graph','chart','plot','cost','price','budget','flops','scale','scaling','size','growth','parameter','parameters','param','params','activation','activations','gpu','gpus','item','items','row','rows','case','cases'],
  probability:['ratio','percent','proportion','fraction'],
  agent:['agent'],
  idea:['idea','insight','concept','approach','method','technique','architecture','design'],
  container:['container','payload','value'],
  request:['request','call','question','query','ask'],
  response:['response','return'],
  input:['input'],
  output:['output'],
  process:['process','step','stage','phase','routing','router','dispatch','sparse','mixture','expert','training','train','pretrain','fine-tune','distill','quantization','quantize'],
  loop:['loop','cycle','iteration'],
  question:['question','query','ask'],
  teacher:['teacher','leadership','leader','compassion','accountability','consent','service','trust','obedience'],
  student:['student'],
  book:['book'],
  example:['example','instance'],
  result:['result','outcome','conclusion'],
  note:['show','visualize','visualise','contrast','compare','highlight','indicate','illustrate'],
  tool:['tool'],
  attract:['attract','attraction'],
  repel:['repel','repulsion'],
  // nature / biology / anatomy / science / history (domain richness)
  leaf:['leaf','leaves','chlorophyll','photosynthesis','stomata'],
  flower:['flower','blossom','petal','petals','pollination','bloom'],
  seed:['seed','seeds','germination','sprout','seedling'],
  water:['water','droplet','droplets','rain','moisture','hydration','fluid','fluids','flow'],
  co2:['co2','carbon dioxide','oxygen','gas exchange','greenhouse gas'],
  tree:['tree','trees','forest','woodland','canopy'],
  heart:['heart','cardiac','circulation','blood','pulse','artery'],
  lung:['lung','lungs','breathing','respiration','alveoli'],
  neuron:['neuron','neurons','nerve','synapse','axon','dendrite'],
  dna:['dna','gene','genes','genetic','genome','chromosome','double helix'],
  magnet:['magnet','magnetic','magnetism','field lines','polarity'],
  globe:['globe','earth','geography','continents','hemisphere'],
  scroll:['scroll','parchment','manuscript','dynasty','empire'],
  scale:['justice','fairness','court','law','verdict'],
  battery:['battery','voltage','charge','stored energy'],
  plant:['plant','plants','crop','vegetation','root'],
  sun:['sun','sunlight','solar','sunshine'],
  cell:['cell','cells','membrane','nucleus','organelle'],
  atom:['atom','atomic','electron','proton','neutron'],
  molecule:['molecule','molecular','compound','chemical bond'],
  energy:['energy','joule','kinetic','potential energy','pressure','force','momentum','velocity'],
  light:['light','lamp','illumination','brightness'],
  temperature:['temperature','thermal','heat','cold','degrees'],
  brain:['brain','cognition','cortex','memory palace','sleep paralysis','dream imagery','confirmation bias','perception','ghost','ghost experience','experiences'],
  equation:['equation','formula','identity','law','theorem','proof','navier stokes','navier-stokes','momentum equation','continuity equation','laplacian'],
  pipeline:['pipeline','stages','stage','workflow','streamline','boundary layer','viscosity','turbulence','reynolds'],
  browser:['browser','dark web','darkweb','people darkweb','people dark web','phishing','website','link','credential','scam','scams','safety'],
};
