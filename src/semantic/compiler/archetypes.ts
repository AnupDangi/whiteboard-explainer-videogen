import type {VisualSceneV2,Rect,VisualArchetype} from '../types.js';
import {BOARD} from './zones.js';
import {NON_STRUCTURAL_RELATIONS} from '../types.js';
import {maxLabelBlock,labelBlock,fitLabel} from './text.js';
const MIN_NOTE=24;
/** Primary-representation bounds each family enforces below. Shared so plan
 *  validation and archetype selection agree with the compiler instead of
 *  discovering the limit as a render-time failure. */
export const ARCHETYPE_CAPACITY:Partial<Record<VisualArchetype,[number,number]>>={flow:[2,5],cycle:[3,6],transformation:[2,4],comparison:[2,4],numbered_steps:[2,7],equation_walkthrough:[2,6],matrix_operation:[3,6],branch:[2,10],cause_effect:[2,10],state_machine:[2,10],hierarchy:[2,12],timeline:[2,6],trajectory:[3,6]};
export const archetypeFits=(archetype:VisualArchetype,count:number):boolean=>{const capacity=ARCHETYPE_CAPACITY[archetype];return !capacity||(count>=capacity[0]&&count<=capacity[1]);};
/** Each family owns its composition. Physical systems never pass through graph layout. */
export function archetypePlacements(scene:VisualSceneV2):Map<string,Rect>{
 const placements=new Map<string,Rect>(),roots=scene.objects.filter(o=>!o.parentId&&o.role!=='annotation'&&o.role!=='decorative_support');
  if(scene.archetype==='flow'){
   if(roots.length<2||roots.length>8)throw new Error('Flow requires 2–8 primary representations');
   const ids=new Set(roots.map(o=>o.id)),edges=scene.relations.filter(r=>ids.has(r.from.objectId)&&ids.has(r.to.objectId)&&!NON_STRUCTURAL_RELATIONS.includes(r.relationType)&&r.visualForm!=='none'&&!r.layoutFeedback);
  const rank=new Map<string,number>(),pending=new Set(ids);
  while(pending.size){const ready=[...pending].filter(id=>edges.filter(e=>e.to.objectId===id).every(e=>rank.has(e.from.objectId))).sort();if(!ready.length)throw new Error('Flow contains a cycle; choose the cycle archetype');for(const id of ready){rank.set(id,Math.max(0,...edges.filter(e=>e.to.objectId===id).map(e=>rank.get(e.from.objectId)!+1)));pending.delete(id);}}
  const count=Math.max(...rank.values())+1;if(count>5)throw new Error('Flow exceeds five readable stages');
  /** Row pitch here is `440/group.length`, which for a three-branch column is
   *  146.7px against a node whose rect plus label block is ~166px — the same
   *  self-inflicted overlap the layered layout had. The position formula is left
   *  alone (existing scenes must keep byte-identical output) and the node is
   *  shortened only when a column is too crowded to hold its rows at full
   *  height. Measured: `Illegal overlap: object_bill/object_committee` on a
   *  three-branch flow column. */
  /** Reserved from the measured block at the worst case the fitter allows, not
   *  a flat 56 that only covers two lines. */
  const LABEL_BLOCK=maxLabelBlock(20),GAP=10,MIN_H=54;
  for(let column=0;column<count;column++){
   const group=roots.filter(o=>rank.get(o.id)===column).sort((a,b)=>a.id.localeCompare(b.id));
   if(group.length>3)throw new Error('Flow column exceeds three readable branches');
   const rowPitch=440/group.length,h=Math.max(MIN_H,Math.min(110,rowPitch-LABEL_BLOCK-GAP));
   group.forEach((o,row)=>placements.set(o.id,{x:100+(column+.5)*1080/count-65,y:150+(row+.5)*rowPitch-70,w:130,h:Math.round(h)}));
  }
 }else if(scene.archetype==='cycle'){
  if(roots.length<3||roots.length>6)throw new Error('Cycle requires 3–6 primary representations');
  const ids=new Set(roots.map(o=>o.id)),edges=scene.relations.filter(r=>ids.has(r.from.objectId)&&ids.has(r.to.objectId)&&!NON_STRUCTURAL_RELATIONS.includes(r.relationType)&&r.visualForm!=='none'&&!r.layoutFeedback),order:string[]=[];let id=[...ids].sort()[0];
 for(let i=0;i<roots.length;i++){
  if(order.includes(id))throw new Error(`Cycle must visit every primary representation (walk revisits ${id} before completing the ring)`);
  order.push(id);
  const next=edges.filter(e=>e.from.objectId===id);
  if(next.length!==1)throw new Error(`Cycle requires one outgoing relation per primary representation (${id} has ${next.length} outgoing relations within the cycle; name the offenders so the owner can repair)`);
  id=next[0].to.objectId;}
  if(id!==order[0])throw new Error('Cycle must close');order.forEach((id,i)=>{const a=-Math.PI/2+i*Math.PI*2/order.length;placements.set(id,{x:640+380*Math.cos(a)-60,y:340+155*Math.sin(a)-45,w:120,h:90});});
 }else if(scene.archetype==='transformation'||scene.archetype==='comparison'){
  if(roots.length<2||roots.length>4)throw new Error('Transformation/comparison requires 2–4 primary representations');
  const cell=1080/roots.length,w=Math.min(240,cell-70);roots.forEach((o,i)=>placements.set(o.id,{x:100+cell*(i+.5)-w/2,y:245,w,h:220}));
 }else if(scene.archetype==='cross_section'||scene.archetype==='spatial_process'){
  const heroes=roots.filter(o=>o.role==='hero');if(heroes.length!==1)throw new Error('Spatial composition requires one central system');
  placements.set(heroes[0].id,{x:280,y:200,w:720,h:310});let support=0;
  for(const o of roots.filter(o=>o!==heroes[0])){if(support>=4)throw new Error('Spatial supports exceed available margins');const left=support%2===0;placements.set(o.id,{x:left?76:1084,y:support<2?200:420,w:120,h:100});support++;}
 }else if(scene.archetype==='numbered_steps'){
  if(roots.length<2||roots.length>7||roots.some(o=>o.primitiveRef!=='label'))throw new Error('Numbered steps require 2–7 concise label objects');
  const row=470/roots.length;roots.forEach((o,i)=>placements.set(o.id,{x:200,y:140+i*row,w:950,h:row-12}));
 }else if(scene.archetype==='equation_walkthrough'){
  if(roots.length<2||roots.length>6)throw new Error('Equation walkthrough requires 2–6 derivation lines');
  // Eq lines stack top-to-bottom as a derivation; short label objects are teacher-voice
  // step notes placed inline between them (compact rows).
  /** The pitch must clear the label block that the fitter places BENEATH a row.
   *  A fixed 14 did not: one line already needs 31px and the fitter permits three
   *  (81px), so every adjacent note pair at a 34+14=48px pitch overlapped. A
   *  `label`/`equation` row keeps 14 because its label is drawn inside the rect.
   *  The gap is measured from the actual labels, so a scene whose labels already
   *  cleared 14 keeps byte-identical geometry (this is what the golden hashes
   *  pin). Rows are scaled together only when they and their labels do not fit
   *  the safe band. */
  const widths=roots.map(o=>o.primitiveRef==='equation'?820:680);
  const blocks=roots.map((o,i)=>o.primitiveRef==='label'||o.primitiveRef==='equation'?0:labelBlock(fitLabel(o.label,Math.max(widths[i],180),20).lines.length,20));
  let gap=Math.max(14,...blocks),rowHeights:number[]=roots.map(o=>o.primitiveRef==='equation'?64:34);
  let total=rowHeights.reduce((a,b)=>a+b,0)+(roots.length-1)*gap,top=(720-total)/2;
  if(total>BOARD.safe.h){const scale=BOARD.safe.h/total;gap=Math.max(14,Math.round(gap*scale));rowHeights=rowHeights.map(h=>Math.max(MIN_NOTE,Math.round(h*scale)));total=rowHeights.reduce((a,b)=>a+b,0)+(roots.length-1)*gap;top=BOARD.safe.y+Math.max(0,Math.round((BOARD.safe.h-total)/2));}
  let y=top;
  roots.forEach((o,index)=>{placements.set(o.id,{x:o.primitiveRef==='equation'?230:300,y,w:widths[index],h:rowHeights[index]});y+=rowHeights[index]+gap;});
 }else if(scene.archetype==='matrix_operation'){
  if(roots.length<3||roots.length>6)throw new Error('Matrix operation requires 3–6 equation terms');
  if(!roots.some(o=>o.primitiveRef==='equation'))throw new Error('Matrix operation requires an operator or equals token');
  if(!roots.some(o=>o.assetRef))throw new Error('Matrix operation requires a matrix or vector asset');
  const totalWidth=1100,gap=18,weights=roots.map(o=>o.assetRef?1.5:.5),sum=weights.reduce((a,b)=>a+b,0),usable=totalWidth-gap*(roots.length-1);let x=90;
  roots.forEach((o,index)=>{const w=usable*weights[index]/sum,h=o.assetRef?200:52;placements.set(o.id,{x,y:(720-h)/2,w,h});x+=w+gap;});
 }else if(scene.archetype==='branch'||scene.archetype==='cause_effect'||scene.archetype==='state_machine'){
  // Layered graph layout for branching graphs (deterministic Sugiyama-lite, no ELK
  // dependency): longest-path ranking, barycenter ordering, bounded to 4 ranks.
  if(roots.length<2||roots.length>10)throw new Error('Branch graph requires 2–10 primary representations');
  const ids=new Set(roots.map(o=>o.id)),edges=scene.relations.filter(r=>ids.has(r.from.objectId)&&ids.has(r.to.objectId)&&!['labels','compares_with'].includes(r.relationType));
  const rank=new Map<string,number>(),pending=new Set(ids);
  while(pending.size){const ready=[...pending].filter(id=>edges.filter(e=>e.to.objectId===id).every(e=>rank.has(e.from.objectId))).sort();if(!ready.length)throw new Error('Branch graph contains a cycle; choose the cycle archetype');for(const id of ready){rank.set(id,Math.max(0,...edges.filter(e=>e.to.objectId===id).map(e=>rank.get(e.from.objectId)!+1)));pending.delete(id);}}
  /** Rank cap derived from label width, not a magic 4. A node's label may be
   *  fitted up to 180px wide and is centred on its rect, so two adjacent ranks
   *  keep their labels apart only when the band is at least 180 + gap. Measured:
   *  a real lesson needed five ranks (sensory -> abduction/induction ->
   *  world-model -> deduction -> prediction) and the old cap of four failed the
   *  job outright. SAFE.w / 188 gives six ranks. */
  const MAX_RANKS=Math.max(4,Math.floor(BOARD.safe.w/188));
  const ranks=Math.max(...rank.values())+1;if(ranks>MAX_RANKS)throw new Error(`Branch graph exceeds ${MAX_RANKS} readable layers`);
  /** Bounded layered grid. The previous row pitch was `400/group.length`
   *  (100px for a 4-node rank) while a node's rect plus its label block is
   *  ~166px tall, so the layout itself manufactured the overlaps the compiler
   *  then rejected as illegal and could not repair. Rows now advance by the
   *  real visual height, and a crowded rank wraps into extra columns inside its
   *  own band instead of stacking into its neighbours. Column width is derived
   *  from the band so horizontal gaps stay positive for every capacity the
   *  archetype admits (2-10 primaries). */
  const SAFE=BOARD.safe,GAP=10,LABEL_BLOCK=maxLabelBlock(20),NOMINAL_H=110,MIN_H=54,MIN_W=60;
  const byRank=new Map<number,string[]>();
  for(const id of ids){const r=rank.get(id)!;byRank.set(r,[...(byRank.get(r)??[]),id]);}
  const bandW=SAFE.w/ranks;
  const maxRowsFull=Math.max(1,Math.floor((SAFE.h-GAP)/(NOMINAL_H+LABEL_BLOCK+GAP)));
  const maxRowsHard=Math.max(1,Math.floor((SAFE.h-GAP)/(MIN_H+LABEL_BLOCK+GAP)));
  const maxColsByWidth=Math.max(1,Math.floor(bandW/(MIN_W+GAP)));
  for(let layer=0;layer<ranks;layer++){
   const group=(byRank.get(layer)??[]).slice().sort((a,b)=>a.localeCompare(b));
   if(!group.length)continue;
   let cols=Math.max(1,Math.min(Math.ceil(group.length/maxRowsFull),maxColsByWidth));
   if(Math.ceil(group.length/cols)>maxRowsHard)cols=Math.max(1,Math.ceil(group.length/maxRowsHard));
   const rows=Math.ceil(group.length/cols),slotW=bandW/cols,rowPitch=(SAFE.h-GAP)/rows;
   const w=Math.min(140,slotW-GAP),h=Math.max(MIN_H,Math.min(NOMINAL_H,rowPitch-LABEL_BLOCK-GAP));
   group.forEach((id,index)=>{
    const col=Math.floor(index/rows),row=index%rows;
    const x=SAFE.x+layer*bandW+col*slotW+(slotW-w)/2;
    const y=SAFE.y+row*rowPitch;
    placements.set(id,{x:Math.round(x),y:Math.round(y),w:Math.round(w),h:Math.round(h)});
   });
  }
 }else if(scene.archetype==='hierarchy'){
  if(roots.length<2||roots.length>12)throw new Error('Hierarchy requires 2–12 nodes');
  const ids=new Set(roots.map(o=>o.id)),edges=scene.relations.filter(r=>ids.has(r.from.objectId)&&ids.has(r.to.objectId)&&r.visualForm!=='none'&&!r.layoutFeedback&&['contains','part_of','depends_on','causes'].includes(r.relationType));
  const children=new Map<string,string[]>(roots.map(o=>[o.id,[]])),indegree=new Map<string,number>(roots.map(o=>[o.id,0]));
  for(const r of edges){const [parent,child]=r.relationType==='part_of'?[r.to.objectId,r.from.objectId]:[r.from.objectId,r.to.objectId],list=children.get(parent)!;if(!list.includes(child))list.push(child);indegree.set(child,indegree.get(child)!+1);}
  const rootIds=roots.filter(o=>indegree.get(o.id)===0).map(o=>o.id);if(rootIds.length!==1)throw new Error('Hierarchy requires exactly one root');
  const depth=new Map<string,number>([[rootIds[0],0]]),queue=[rootIds[0]],preorder:string[]=[];
  while(queue.length){const id=queue.shift()!;preorder.push(id);for(const child of children.get(id)!){if(depth.has(child))throw new Error('Hierarchy contains a cycle');depth.set(child,depth.get(id)!+1);queue.push(child);}}
  if(preorder.length!==ids.size)throw new Error('Hierarchy must be connected');
  if(Math.max(...depth.values())>2)throw new Error('Hierarchy exceeds three readable levels');
  const leaves=preorder.filter(id=>children.get(id)!.length===0),slot=1100/Math.max(1,leaves.length),center=new Map<string,number>();
  leaves.forEach((id,index)=>center.set(id,90+slot*(index+.5)));
  for(const id of [...preorder].reverse()){const kids=children.get(id)!;if(kids.length)center.set(id,kids.reduce((sum,k)=>sum+(center.get(k)??0),0)/kids.length);}
  const rowHeight=150,baseY=160,nodeWidth=Math.min(200,slot-30),nodeHeight=56;
  for(const o of roots){const level=depth.get(o.id)!;placements.set(o.id,{x:(center.get(o.id)??640)-nodeWidth/2,y:baseY+level*rowHeight,w:nodeWidth,h:nodeHeight});}
 }else if(scene.archetype==='timeline'){
  if(roots.length<2||roots.length>6||roots.some(o=>o.primitiveRef!=='label'))throw new Error('Timeline requires 2–6 ordered label events');
  const cell=1040/roots.length,w=Math.min(230,cell-30);
  roots.forEach((o,index)=>placements.set(o.id,{x:100+cell*(index+.5)-w/2,y:300,w,h:56}));
 }else if(scene.archetype==='trajectory'){
  if(roots.length<3||roots.length>6||roots.some(o=>o.primitiveRef!=='label'))throw new Error('Trajectory requires 3–6 ordered step labels');
  const span=880,left=90;
  roots.forEach((o,index)=>{const t=index/(roots.length-1);placements.set(o.id,{x:left+t*span,y:200+300*t*t,w:230,h:50});});
 }
 return placements;
}
