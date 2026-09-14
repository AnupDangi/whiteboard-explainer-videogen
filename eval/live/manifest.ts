import type {VisualArchetype} from '../../src/semantic/types.js';

export interface SemanticRelationRequirement {
  id: string;
  fromConcept: string;
  relation: string;
  toConcept: string;
  targetPart?: string;
}

export interface LiveEvalCase {
  id: string;
  prompt: string;
  category: string;
  mustExplain: string[];
  expectedConcepts?: string[];
  requiredRelations?: SemanticRelationRequirement[];
  preferredArchetypes?: VisualArchetype[];
  forbiddenPatterns?: string[];
  criticalAssetRoles?: string[];
}

export const LIVE_EVAL_CATEGORIES = [
  'structural','spatial_process','transformation','flow','cause_effect','cycle',
  'comparison','hierarchy','timeline','equation','matrix','trajectory',
  'list_facts','network'
] as const;

export const LIVE_EVAL_CASES: LiveEvalCase[] = [
  // Structural / spatial process
  {
    id: 'photosynthesis_inputs',
    category: 'structural',
    prompt: 'Explain how plants make food to a middle-school student. For this first scene, teach the three inputs: sunlight arriving at leaves, water arriving at roots, and carbon dioxide entering leaves. Establish a plant as the central system, introduce each input, and restate how they enable food production.',
    mustExplain: ['plant is central system', 'sunlight reaches leaves', 'water reaches roots', 'carbon dioxide enters leaves'],
    expectedConcepts: ['plant','sunlight','water','carbon_dioxide','leaf','roots'],
    requiredRelations: [
      {id:'sun_to_plant',fromConcept:'sunlight',relation:'enters',toConcept:'plant',targetPart:'leaf'},
      {id:'water_to_plant',fromConcept:'water',relation:'enters',toConcept:'plant',targetPart:'roots'},
      {id:'co2_to_plant',fromConcept:'carbon_dioxide',relation:'enters',toConcept:'plant',targetPart:'leaf'}
    ],
    preferredArchetypes: ['structural_diagram','convergence'],
    criticalAssetRoles: ['hero plant','support sunlight','support water','support co2']
  },
  {
    id: 'photosynthesis_chloroplast',
    category: 'spatial_process',
    prompt: 'Continue the plant lesson. Now zoom into a leaf and show the chloroplast using light energy to split water and fix carbon dioxide into sugar. Keep the chemistry conceptual; emphasize location and sequence.',
    mustExplain: ['leaf contains chloroplast', 'light energy drives reaction', 'water splits', 'carbon dioxide is fixed', 'sugar is produced'],
    expectedConcepts: ['leaf','chloroplast','sunlight','water','carbon_dioxide','sugar'],
    preferredArchetypes: ['cross_section','spatial_process']
  },
  {
    id: 'cell_animal',
    category: 'structural',
    prompt: 'Teach the basic structure of an animal cell to a middle-school student. Show the nucleus, mitochondria, cell membrane, and cytoplasm. Explain what each part does.',
    mustExplain: ['nucleus stores DNA', 'mitochondria make energy', 'membrane controls entry', 'cytoplasm fills the cell'],
    expectedConcepts: ['cell','nucleus','mitochondria','membrane','cytoplasm','dna'],
    preferredArchetypes: ['structural_diagram','cross_section']
  },
  {
    id: 'cell_plant',
    category: 'structural',
    prompt: 'Teach the basic structure of a plant cell. Show the cell wall, chloroplasts, vacuole, nucleus, and mitochondria. Contrast the plant cell with the animal cell.',
    mustExplain: ['cell wall provides support', 'chloroplasts perform photosynthesis', 'vacuole stores water', 'nucleus holds DNA'],
    expectedConcepts: ['plant_cell','cell_wall','chloroplast','vacuole','nucleus','mitochondria'],
    preferredArchetypes: ['structural_diagram','comparison']
  },
  {
    id: 'dna_replication',
    category: 'spatial_process',
    prompt: 'Explain DNA replication. Show the double helix unwinding at a replication fork, strands separating, and new complementary bases pairing. Emphasize that each new DNA molecule keeps one original strand.',
    mustExplain: ['double helix unwinds', 'replication fork forms', 'strands separate', 'complementary bases pair', 'semiconservative result'],
    expectedConcepts: ['dna','helix','replication_fork','strand','base_pair','polymerase'],
    requiredRelations: [
      {id:'helix_to_fork',fromConcept:'dna',relation:'transforms_to',toConcept:'replication_fork'},
      {id:'fork_to_strands',fromConcept:'replication_fork',relation:'produces',toConcept:'strand'},
      {id:'bases_pair',fromConcept:'base_pair',relation:'forms',toConcept:'strand'}
    ],
    preferredArchetypes: ['spatial_process','transformation']
  },
  {
    id: 'plate_tectonics',
    category: 'spatial_process',
    prompt: 'Explain plate tectonics at a convergent boundary. Show an oceanic plate subducting under a continental plate, magma rising, and a volcano forming. Use a cross-section view.',
    mustExplain: ['oceanic plate subducts', 'continental plate overrides', 'subduction generates magma', 'magma rises', 'volcano forms at surface'],
    expectedConcepts: ['oceanic_plate','continental_plate','subduction_zone','magma','volcano','mantle'],
    preferredArchetypes: ['cross_section']
  },
  {
    id: 'water_cycle',
    category: 'cycle',
    prompt: 'Explain the water cycle. Show evaporation from the ocean, condensation into clouds, precipitation over land, and runoff returning to the ocean. Emphasize the cyclic flow.',
    mustExplain: ['ocean water evaporates', 'vapor condenses into clouds', 'clouds precipitate rain', 'runoff returns water'],
    expectedConcepts: ['ocean','evaporation','cloud','condensation','precipitation','runoff'],
    requiredRelations: [
      {id:'ocean_to_cloud',fromConcept:'ocean',relation:'transforms_to',toConcept:'cloud'},
      {id:'cloud_to_rain',fromConcept:'cloud',relation:'produces',toConcept:'precipitation'},
      {id:'rain_to_runoff',fromConcept:'precipitation',relation:'flows_to',toConcept:'runoff'},
      {id:'runoff_to_ocean',fromConcept:'runoff',relation:'flows_to',toConcept:'ocean'}
    ],
    preferredArchetypes: ['cycle']
  },
  {
    id: 'refrigeration_cycle',
    category: 'cycle',
    prompt: 'Explain a refrigeration cycle. Show the compressor raising refrigerant pressure, the condenser releasing heat, the expansion valve dropping pressure, and the evaporator absorbing heat.',
    mustExplain: ['compressor raises pressure', 'condenser releases heat', 'expansion valve drops pressure', 'evaporator absorbs heat'],
    expectedConcepts: ['compressor','condenser','expansion_valve','evaporator','refrigerant'],
    requiredRelations: [
      {id:'compressor_to_condenser',fromConcept:'compressor',relation:'flows_to',toConcept:'condenser'},
      {id:'condenser_to_valve',fromConcept:'condenser',relation:'flows_to',toConcept:'expansion_valve'},
      {id:'valve_to_evaporator',fromConcept:'expansion_valve',relation:'flows_to',toConcept:'evaporator'},
      {id:'evaporator_to_compressor',fromConcept:'evaporator',relation:'flows_to',toConcept:'compressor'}
    ],
    preferredArchetypes: ['cycle']
  },

  // Equation / math
  {
    id: 'linear_equation',
    category: 'equation',
    prompt: 'Teach how to solve a linear equation step by step. Use 2x + 5 = 13. Show subtracting 5 from both sides, then dividing by 2.',
    mustExplain: ['subtract 5 from both sides', 'divide both sides by 2', 'solution is x = 4'],
    expectedConcepts: ['equation','variable','constant','coefficient','solution'],
    preferredArchetypes: ['equation_walkthrough']
  },
  {
    id: 'quadratic_equation',
    category: 'equation',
    prompt: 'Explain how to solve a quadratic equation by factoring. Use x² - 5x + 6 = 0. Show finding two numbers that multiply to 6 and add to -5.',
    mustExplain: ['find factors of 6', 'factors add to -5', 'rewrite as (x-2)(x-3)', 'solutions x=2 and x=3'],
    expectedConcepts: ['quadratic','factor','root','solution'],
    preferredArchetypes: ['equation_walkthrough']
  },
  {
    id: 'matrix_multiplication',
    category: 'matrix',
    prompt: 'Explain matrix multiplication using a 2x2 example. Show how each entry in the result is the dot product of a row from the first matrix and a column from the second.',
    mustExplain: ['row from first matrix', 'column from second matrix', 'dot product gives entry', 'result has same row/column shape'],
    expectedConcepts: ['matrix','row','column','dot_product','entry'],
    preferredArchetypes: ['matrix_operation']
  },
  {
    id: 'gradient_descent',
    category: 'trajectory',
    prompt: 'Explain gradient descent for minimizing a function. Show a starting point, the slope at that point, and repeated steps downhill until reaching a valley.',
    mustExplain: ['start at initial point', 'compute slope', 'step opposite to gradient', 'converge toward minimum'],
    expectedConcepts: ['function','gradient','step','minimum','slope'],
    preferredArchetypes: ['trajectory']
  },
  {
    id: 'pythagorean_theorem',
    category: 'equation',
    prompt: 'Explain the Pythagorean theorem with a right triangle. Show that a² + b² = c² and how it lets you find the hypotenuse.',
    mustExplain: ['right triangle has legs a and b', 'hypotenuse is c', 'a² + b² = c²', 'can solve for c'],
    expectedConcepts: ['right_triangle','leg','hypotenuse','square'],
    preferredArchetypes: ['equation_walkthrough']
  },

  // AI / ML / CS
  {
    id: 'transformer_attention',
    category: 'flow',
    prompt: 'Explain transformer self-attention. Show tokens producing query, key, and value vectors, computing attention scores, and producing weighted output.',
    mustExplain: ['tokens create Q, K, V', 'scores measure compatibility', 'softmax turns scores to weights', 'output is weighted sum of values'],
    expectedConcepts: ['token','query','key','value','attention_score','weight','output'],
    preferredArchetypes: ['flow','branch']
  },
  {
    id: 'kv_cache',
    category: 'spatial_process',
    prompt: 'Explain the KV cache in transformer inference. Show that previously computed keys and values are stored so each new token only computes a new query.',
    mustExplain: ['keys and values stored', 'new token computes query', 'query attends to all past K/V', 'avoids recomputation'],
    expectedConcepts: ['kv_cache','key','value','query','token'],
    preferredArchetypes: ['spatial_process','comparison']
  },
  {
    id: 'deepseek_mla',
    category: 'comparison',
    prompt: 'Explain DeepSeek Multi-head Latent Attention. Compare standard attention which stores large key/value caches with MLA which compresses them into a latent vector and reconstructs them.',
    mustExplain: ['standard attention stores large K/V cache', 'MLA compresses to latent vector', 'latent vector reconstructs K/V', 'compression reduces memory'],
    expectedConcepts: ['attention','key','value','cache','latent_vector','compression'],
    requiredRelations: [
      {id:'kv_to_latent',fromConcept:'key_value_cache',relation:'compresses_to',toConcept:'latent_vector'},
      {id:'latent_to_kv',fromConcept:'latent_vector',relation:'reconstructs',toConcept:'key_value_cache'}
    ],
    preferredArchetypes: ['comparison']
  },
  {
    id: 'expert_routing',
    category: 'flow',
    prompt: 'Explain mixture-of-experts routing. Show input tokens being routed to a small subset of expert networks, then the selected expert outputs being combined.',
    mustExplain: ['input token arrives', 'router selects experts', 'chosen experts process token', 'outputs combine'],
    expectedConcepts: ['token','router','expert','gate','output'],
    preferredArchetypes: ['flow']
  },
  {
    id: 'rag_pipeline',
    category: 'flow',
    prompt: 'Explain a retrieval-augmented generation pipeline. Show a user query retrieving relevant documents, those documents being added to context, and the model generating an answer.',
    mustExplain: ['query enters system', 'retriever finds documents', 'documents join context', 'generator produces answer'],
    expectedConcepts: ['query','retriever','document','context','generator','answer'],
    preferredArchetypes: ['flow']
  },
  {
    id: 'http_lifecycle',
    category: 'flow',
    prompt: 'Explain the lifecycle of an HTTP GET request. Show the browser sending a request, DNS lookup, server receiving it, server querying a database, and the response returning.',
    mustExplain: ['browser sends request', 'DNS resolves name', 'server receives request', 'server queries database', 'response returns to browser'],
    expectedConcepts: ['browser','dns','server','database','request','response'],
    requiredRelations: [
      {id:'browser_to_dns',fromConcept:'browser',relation:'queries',toConcept:'dns'},
      {id:'dns_to_server',fromConcept:'dns',relation:'resolves_to',toConcept:'server'},
      {id:'server_to_db',fromConcept:'server',relation:'queries',toConcept:'database'},
      {id:'server_to_browser',fromConcept:'server',relation:'responds_to',toConcept:'browser'}
    ],
    preferredArchetypes: ['flow']
  },
  {
    id: 'cache_hit_miss',
    category: 'comparison',
    prompt: 'Explain cache hit versus cache miss. Contrast the fast path when data is already in cache with the slow path that fetches from the origin.',
    mustExplain: ['check cache first', 'hit returns fast', 'miss fetches from origin', 'origin populates cache'],
    expectedConcepts: ['cache','origin','hit','miss','request'],
    preferredArchetypes: ['comparison']
  },
  {
    id: 'tcp_congestion',
    category: 'cause_effect',
    prompt: 'Explain TCP congestion control. Show the sender increasing its window, detecting packet loss, then reducing the window and growing again.',
    mustExplain: ['sender increases window', 'packet loss detected', 'window reduces sharply', 'window grows gradually'],
    expectedConcepts: ['sender','window','packet','loss','acknowledgment'],
    preferredArchetypes: ['cause_effect','cycle']
  },

  // Business / social systems
  {
    id: 'bank_transfer',
    category: 'flow',
    prompt: 'Explain how a bank transfer works. Show money leaving the sender account, the payment network processing it, and money arriving in the receiver account.',
    mustExplain: ['sender authorizes transfer', 'bank debits sender', 'network routes payment', 'receiver bank credits account'],
    expectedConcepts: ['sender','receiver','bank','payment_network','money'],
    preferredArchetypes: ['flow']
  },
  {
    id: 'inflation_feedback',
    category: 'cause_effect',
    prompt: 'Explain inflation as a feedback loop. Rising prices lead workers to demand higher wages, which raises production costs, which further raises prices.',
    mustExplain: ['prices rise', 'workers demand higher wages', 'wages raise costs', 'costs push prices higher'],
    expectedConcepts: ['price','wage','cost','inflation'],
    preferredArchetypes: ['cause_effect','cycle']
  },
  {
    id: 'supply_demand',
    category: 'comparison',
    prompt: 'Explain supply and demand. Show how higher demand shifts the demand curve and raises equilibrium price, and how higher supply shifts the supply curve and lowers it.',
    mustExplain: ['demand curve', 'supply curve', 'equilibrium price', 'shift in demand raises price', 'shift in supply lowers price'],
    expectedConcepts: ['demand','supply','equilibrium','price','quantity'],
    preferredArchetypes: ['comparison']
  },

  // History / timeline
  {
    id: 'roman_empire_timeline',
    category: 'timeline',
    prompt: 'Explain the fall of the Western Roman Empire as a causal timeline. Include political instability, economic troubles, military defeats, and the final sack of Rome.',
    mustExplain: ['political instability weakens governance', 'economic troubles reduce revenue', 'military defeats shrink territory', 'Rome is sacked in 476 CE'],
    expectedConcepts: ['empire','instability','economy','military','defeat','sack'],
    preferredArchetypes: ['timeline']
  },
  {
    id: 'industrial_revolution',
    category: 'cause_effect',
    prompt: 'Explain the Industrial Revolution as a chain of causes and effects. Start with agricultural surplus and capital accumulation, then mechanization, urbanization, and environmental effects.',
    mustExplain: ['agricultural surplus frees workers', 'capital funds machines', 'mechanization raises output', 'urbanization concentrates population', 'pollution rises'],
    expectedConcepts: ['agriculture','capital','machine','factory','city','pollution'],
    preferredArchetypes: ['cause_effect','timeline']
  },

  // Robotics / physics
  {
    id: 'robot_path_planning',
    category: 'trajectory',
    prompt: 'Explain robot path planning in a grid. Show the start, goal, obstacles, and a planned path that avoids obstacles.',
    mustExplain: ['start cell', 'goal cell', 'obstacles block movement', 'planner finds valid path'],
    expectedConcepts: ['grid','start','goal','obstacle','path','planner'],
    preferredArchetypes: ['trajectory']
  },
  {
    id: 'projectile_trajectory',
    category: 'trajectory',
    prompt: 'Explain projectile motion. Show horizontal motion at constant velocity and vertical motion under gravity combining into a parabolic path.',
    mustExplain: ['horizontal velocity constant', 'vertical acceleration from gravity', 'combined path is parabola', 'peak height when vertical velocity zero'],
    expectedConcepts: ['projectile','horizontal_velocity','gravity','parabola','peak'],
    preferredArchetypes: ['trajectory']
  },
  {
    id: 'newton_third_law',
    category: 'comparison',
    prompt: "Explain Newton's third law. Show that for every action force there is an equal and opposite reaction force, using a person pushing on a wall.",
    mustExplain: ['person pushes wall with force', 'wall pushes back with equal force', 'forces are opposite in direction', 'forces act on different objects'],
    expectedConcepts: ['force','action','reaction','wall','person'],
    preferredArchetypes: ['comparison']
  },

  // List / facts
  {
    id: 'layers_earth',
    category: 'hierarchy',
    prompt: 'Explain the layers of the Earth from crust to inner core. Describe each layer and what it is made of.',
    mustExplain: ['crust is thin solid surface', 'mantle is thick semi-solid', 'outer core is liquid metal', 'inner core is solid metal'],
    expectedConcepts: ['crust','mantle','outer_core','inner_core'],
    preferredArchetypes: ['hierarchy']
  },
  {
    id: 'food_chain',
    category: 'hierarchy',
    prompt: 'Explain a simple food chain. Show grass, a rabbit, and a fox, with arrows showing energy flow.',
    mustExplain: ['grass captures energy', 'rabbit eats grass', 'fox eats rabbit', 'energy flows up the chain'],
    expectedConcepts: ['grass','rabbit','fox','energy','predator','prey'],
    preferredArchetypes: ['hierarchy','flow']
  },
  {
    id: 'parts_computer',
    category: 'structural',
    prompt: 'Explain the main parts of a computer. Show CPU, memory, storage, and input/output devices, and what each does.',
    mustExplain: ['CPU processes instructions', 'memory holds active data', 'storage persists files', 'input/output lets user interact'],
    expectedConcepts: ['cpu','memory','storage','input_device','output_device'],
    preferredArchetypes: ['structural_diagram']
  },
  {
    id: 'immune_response',
    category: 'flow',
    prompt: 'Explain the adaptive immune response. Show a pathogen being recognized by a T-cell, B-cells producing antibodies, and antibodies neutralizing the pathogen.',
    mustExplain: ['pathogen invades', 'T-cell recognizes antigen', 'B-cell produces antibodies', 'antibodies neutralize pathogen'],
    expectedConcepts: ['pathogen','t_cell','b_cell','antibody','antigen'],
    preferredArchetypes: ['flow']
  },
  {
    id: 'photosynthesis_products',
    category: 'transformation',
    prompt: 'Explain the outputs of photosynthesis. Show how inputs sunlight, water, and carbon dioxide are transformed into glucose and oxygen.',
    mustExplain: ['inputs are sunlight, water, CO2', 'glucose is produced', 'oxygen is released', 'transformation happens in chloroplast'],
    expectedConcepts: ['sunlight','water','carbon_dioxide','glucose','oxygen','chloroplast'],
    preferredArchetypes: ['transformation']
  },
  {
    id: 'evolution_natural_selection',
    category: 'transformation',
    prompt: 'Explain natural selection. Show variation in a population, environmental pressure, differential survival, and inherited trait change over generations.',
    mustExplain: ['population has variation', 'environment applies pressure', 'some individuals survive better', 'surviving traits increase over generations'],
    expectedConcepts: ['population','variation','environment','survival','trait','generation'],
    preferredArchetypes: ['transformation']
  },
  {
    id: 'circuit_series_parallel',
    category: 'comparison',
    prompt: 'Compare series and parallel electric circuits. Show how current and voltage behave differently in each configuration.',
    mustExplain: ['series has single path', 'parallel has multiple paths', 'series current same everywhere', 'parallel voltage same across branches'],
    expectedConcepts: ['circuit','series','parallel','current','voltage','resistor'],
    preferredArchetypes: ['comparison']
  },
  {
    id: 'binary_search',
    category: 'flow',
    prompt: 'Explain binary search. Show a sorted list, checking the middle element, eliminating half, and repeating until the target is found or excluded.',
    mustExplain: ['list must be sorted', 'compare target to middle', 'eliminate half of list', 'repeat until found'],
    expectedConcepts: ['sorted_list','target','middle','eliminate','search'],
    preferredArchetypes: ['flow']
  },
  {
    id: 'recursion_factorial',
    category: 'flow',
    prompt: 'Explain recursion using factorial. Show a function calling itself with n-1 until reaching the base case, then multiplying the results back up.',
    mustExplain: ['factorial n calls factorial n-1', 'base case is 0 or 1', 'results multiply on return', 'stack unwinds'],
    expectedConcepts: ['function','recursion','base_case','stack','factorial'],
    preferredArchetypes: ['flow','hierarchy']
  },
  {
    id: 'neuron_signal',
    category: 'spatial_process',
    prompt: 'Explain how a neuron transmits a signal. Show dendrites receiving input, the signal traveling down the axon, and neurotransmitters crossing the synapse.',
    mustExplain: ['dendrites receive signal', 'axon transmits signal', 'synapse releases neurotransmitters', 'next neuron receives signal'],
    expectedConcepts: ['neuron','dendrite','axon','synapse','neurotransmitter'],
    preferredArchetypes: ['spatial_process']
  },
  {
    id: 'climate_change_feedback',
    category: 'cause_effect',
    prompt: 'Explain a climate feedback loop. Rising temperatures melt ice, reducing reflection and exposing darker ocean, which absorbs more heat, raising temperatures further.',
    mustExplain: ['temperature rises', 'ice melts', 'less sunlight reflected', 'ocean absorbs more heat', 'temperature rises more'],
    expectedConcepts: ['temperature','ice','albedo','ocean','heat'],
    preferredArchetypes: ['cause_effect','cycle']
  },
  {
    id: 'ph_scale',
    category: 'hierarchy',
    prompt: 'Explain the pH scale. Show acids on the low end, bases on the high end, and neutral in the middle, with examples.',
    mustExplain: ['pH below 7 is acidic', 'pH 7 is neutral', 'pH above 7 is basic', 'examples at extremes'],
    expectedConcepts: ['ph','acid','base','neutral','scale'],
    preferredArchetypes: ['hierarchy','numbered_steps']
  },
  {
    id: 'encryption_public_key',
    category: 'flow',
    prompt: 'Explain public-key encryption. Show a sender encrypting a message with the receiver public key, and the receiver decrypting with their private key.',
    mustExplain: ['public key encrypts', 'private key decrypts', 'only receiver can read', 'keys are mathematically paired'],
    expectedConcepts: ['public_key','private_key','message','encrypt','decrypt'],
    preferredArchetypes: ['flow']
  },
  {
    id: 'gene_expression',
    category: 'flow',
    prompt: 'Explain gene expression. Show DNA being transcribed into mRNA, mRNA leaving the nucleus, and ribosomes translating it into a protein.',
    mustExplain: ['DNA transcribed to mRNA', 'mRNA exits nucleus', 'ribosome translates mRNA', 'protein folds into shape'],
    expectedConcepts: ['dna','mrna','ribosome','protein','transcription','translation'],
    preferredArchetypes: ['flow']
  },
  {
    id: 'black_hole_formation',
    category: 'transformation',
    prompt: 'Explain black hole formation from a massive star. Show fusion ending, core collapse, supernova explosion, and remaining core becoming a black hole.',
    mustExplain: ['fusion stops in core', 'core collapses under gravity', 'supernova ejects outer layers', 'collapsed core forms black hole'],
    expectedConcepts: ['star','fusion','core','collapse','supernova','black_hole'],
    preferredArchetypes: ['transformation']
  },
  {
    id: 'market_circular_flow',
    category: 'cycle',
    prompt: 'Explain the circular flow of income. Show households supplying labor to firms, firms paying wages, households buying goods, and firms receiving revenue.',
    mustExplain: ['households supply labor', 'firms pay wages', 'households buy goods', 'firms earn revenue'],
    expectedConcepts: ['household','firm','labor','wage','goods','revenue'],
    preferredArchetypes: ['cycle']
  },
  {
    id: 'algorithm_sorting',
    category: 'comparison',
    prompt: 'Compare bubble sort and merge sort. Explain bubble sort repeatedly swapping adjacent elements and merge sort dividing, sorting halves, and merging.',
    mustExplain: ['bubble sort swaps neighbors', 'merge sort divides list', 'merge sort sorts halves', 'merge sort merges sorted halves'],
    expectedConcepts: ['bubble_sort','merge_sort','swap','divide','merge'],
    preferredArchetypes: ['comparison']
  },
  {
    id: 'chemical_reaction',
    category: 'transformation',
    prompt: 'Explain a chemical reaction using hydrogen and oxygen forming water. Show reactants breaking bonds and products forming new bonds.',
    mustExplain: ['hydrogen and oxygen are reactants', 'bonds break', 'new bonds form', 'water is product'],
    expectedConcepts: ['hydrogen','oxygen','water','reactant','product','bond'],
    preferredArchetypes: ['transformation']
  },
  {
    id: 'machine_learning_training',
    category: 'cause_effect',
    prompt: 'Explain training a neural network. Show input passing forward, loss computed, gradients propagated backward, and weights updated to reduce loss.',
    mustExplain: ['input produces prediction', 'loss measures error', 'gradients flow backward', 'weights update to lower loss'],
    expectedConcepts: ['input','prediction','loss','gradient','weight','update'],
    preferredArchetypes: ['cause_effect','cycle']
  }
];

export const SMOKE_CASE_IDS = [
  'photosynthesis_inputs',
  'linear_equation',
  'dna_replication',
  'matrix_multiplication',
  'http_lifecycle',
  'deepseek_mla'
];

export function getCase(id: string): LiveEvalCase {
  const c = LIVE_EVAL_CASES.find(x => x.id === id);
  if (!c) throw new Error(`Unknown live eval case: ${id}`);
  return c;
}

export function caseCount(): number {
  return LIVE_EVAL_CASES.length;
}
