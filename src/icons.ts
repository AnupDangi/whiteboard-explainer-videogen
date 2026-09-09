import type {NodeKind} from './vocabulary.js';
/** Small, deterministic, hand-drawn-consistent glyphs — deliberately simple per the
 *  replication target's "simple icons" requirement, not detailed illustration. Each
 *  renderer draws inside a circle of radius r centered at (cx, cy). */
type IconFn = (cx:number, cy:number, r:number, stroke:string) => string;
const line=(x1:number,y1:number,x2:number,y2:number,stroke:string,w=2.4)=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"/>`;
const circle=(cx:number,cy:number,r:number,stroke:string,fill='none',w=2.4)=>`<circle cx="${cx}" cy="${cy}" r="${r}" stroke="${stroke}" stroke-width="${w}" fill="${fill}"/>`;
const rect=(x:number,y:number,w:number,h:number,stroke:string,rx=2,fill='none',sw=2.4)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" stroke="${stroke}" stroke-width="${sw}" fill="${fill}"/>`;
const path=(d:string,stroke:string,fill='none',w=2.4)=>`<path d="${d}" stroke="${stroke}" stroke-width="${w}" fill="${fill}" stroke-linecap="round" stroke-linejoin="round"/>`;

const ICONS: Partial<Record<NodeKind, IconFn>> = {
  question: (cx,cy,r,s)=>circle(cx,cy,r,s)+`<text x="${cx}" y="${cy+r*0.38}" text-anchor="middle" font-size="${r*1.15}" font-weight="700" fill="${s}">?</text>`,
  key: (cx,cy,r,s)=>circle(cx-r*0.35,cy,r*0.5,s)+line(cx-r*0.05,cy,cx+r*0.85,cy,s)+line(cx+r*0.6,cy,cx+r*0.6,cy+r*0.35,s)+line(cx+r*0.85,cy,cx+r*0.85,cy+r*0.35,s),
  container: (cx,cy,r,s)=>rect(cx-r*0.85,cy-r*0.65,r*1.7,r*1.3,s,3)+line(cx-r*0.85,cy+r*0.05,cx+r*0.85,cy+r*0.05,s,1.8),
  database: (cx,cy,r,s)=>`<ellipse cx="${cx}" cy="${cy-r*0.55}" rx="${r*0.75}" ry="${r*0.28}" stroke="${s}" stroke-width="2.2" fill="none"/>`+line(cx-r*0.75,cy-r*0.55,cx-r*0.75,cy+r*0.55,s,2.2)+line(cx+r*0.75,cy-r*0.55,cx+r*0.75,cy+r*0.55,s,2.2)+`<path d="M ${cx-r*0.75} ${cy+r*0.55} A ${r*0.75} ${r*0.28} 0 0 0 ${cx+r*0.75} ${cy+r*0.55}" stroke="${s}" stroke-width="2.2" fill="none"/>`,
  model: (cx,cy,r,s)=>{const pts=[[cx,cy-r*0.75],[cx-r*0.75,cy+r*0.5],[cx+r*0.75,cy+r*0.5]];return pts.map(p=>circle(p[0],p[1],r*0.22,s,'#fffef9',2)).join('')+line(pts[0][0],pts[0][1],pts[1][0],pts[1][1],s,1.8)+line(pts[0][0],pts[0][1],pts[2][0],pts[2][1],s,1.8)+line(pts[1][0],pts[1][1],pts[2][0],pts[2][1],s,1.8);},
  user: (cx,cy,r,s)=>circle(cx,cy-r*0.35,r*0.38,s)+path(`M ${cx-r*0.7} ${cy+r*0.75} A ${r*0.7} ${r*0.55} 0 0 1 ${cx+r*0.7} ${cy+r*0.75}`,s),
  document: (cx,cy,r,s)=>rect(cx-r*0.55,cy-r*0.8,r*1.1,r*1.6,s,2)+line(cx-r*0.3,cy-r*0.25,cx+r*0.3,cy-r*0.25,s,1.6)+line(cx-r*0.3,cy+r*0.1,cx+r*0.3,cy+r*0.1,s,1.6)+line(cx-r*0.3,cy+r*0.45,cx+r*0.05,cy+r*0.45,s,1.6),
  api: (cx,cy,r,s)=>path(`M ${cx-r*0.15} ${cy-r*0.75} C ${cx-r*0.85} ${cy-r*0.5} ${cx-r*0.85} ${cy+r*0.5} ${cx-r*0.15} ${cy+r*0.75}`,s)+path(`M ${cx+r*0.15} ${cy-r*0.75} C ${cx+r*0.85} ${cy-r*0.5} ${cx+r*0.85} ${cy+r*0.5} ${cx+r*0.15} ${cy+r*0.75}`,s),
  cloud: (cx,cy,r,s)=>circle(cx-r*0.4,cy+r*0.1,r*0.42,s)+circle(cx+r*0.15,cy-r*0.15,r*0.5,s)+circle(cx+r*0.6,cy+r*0.15,r*0.36,s)+`<rect x="${cx-r*0.75}" y="${cy+r*0.1}" width="${r*1.5}" height="${r*0.35}" rx="${r*0.17}" stroke="${s}" stroke-width="2.2" fill="#fffef9"/>`,
  memory: (cx,cy,r,s)=>rect(cx-r*0.7,cy-r*0.7,r*0.6,r*0.6,s,1.5)+rect(cx+r*0.1,cy-r*0.7,r*0.6,r*0.6,s,1.5)+rect(cx-r*0.7,cy+r*0.1,r*0.6,r*0.6,s,1.5)+rect(cx+r*0.1,cy+r*0.1,r*0.6,r*0.6,s,1.5),
  search: (cx,cy,r,s)=>circle(cx-r*0.15,cy-r*0.15,r*0.55,s)+line(cx+r*0.28,cy+r*0.28,cx+r*0.75,cy+r*0.75,s,2.6),
  vector: (cx,cy,r,s)=>circle(cx-r*0.7,cy+r*0.7,r*0.12,s,s)+path(`M ${cx-r*0.7} ${cy+r*0.7} L ${cx+r*0.6} ${cy-r*0.6} M ${cx+r*0.1} ${cy-r*0.6} L ${cx+r*0.6} ${cy-r*0.6} L ${cx+r*0.6} ${cy-r*0.1}`,s),
  token: (cx,cy,r,s)=>rect(cx-r*0.6,cy-r*0.6,r*1.2,r*1.2,s,4)+circle(cx,cy,r*0.18,s,s),
  brain: (cx,cy,r,s)=>path(`M ${cx-r*0.1} ${cy-r*0.7} C ${cx-r*0.95} ${cy-r*0.7} ${cx-r*0.95} ${cy+r*0.7} ${cx-r*0.1} ${cy+r*0.7} M ${cx+r*0.1} ${cy-r*0.7} C ${cx+r*0.95} ${cy-r*0.7} ${cx+r*0.95} ${cy+r*0.7} ${cx+r*0.1} ${cy+r*0.7}`,s)+line(cx,cy-r*0.65,cx,cy+r*0.65,s,1.6),
  lock: (cx,cy,r,s)=>rect(cx-r*0.55,cy-r*0.05,r*1.1,r*0.85,s,2)+path(`M ${cx-r*0.35} ${cy-r*0.05} L ${cx-r*0.35} ${cy-r*0.4} A ${r*0.35} ${r*0.35} 0 0 1 ${cx+r*0.35} ${cy-r*0.4} L ${cx+r*0.35} ${cy-r*0.05}`,s),
  warning: (cx,cy,r,s)=>`<path d="M ${cx} ${cy-r*0.85} L ${cx+r*0.85} ${cy+r*0.6} L ${cx-r*0.85} ${cy+r*0.6} Z" stroke="${s}" stroke-width="2.4" fill="none" stroke-linejoin="round"/>`+`<text x="${cx}" y="${cy+r*0.45}" text-anchor="middle" font-size="${r*1.05}" font-weight="700" fill="${s}">!</text>`,
  success: (cx,cy,r,s)=>circle(cx,cy,r,s)+path(`M ${cx-r*0.45} ${cy} L ${cx-r*0.1} ${cy+r*0.4} L ${cx+r*0.5} ${cy-r*0.4}`,s),
  graph: (cx,cy,r,s)=>[[-0.6,0.3],[0,0.6],[0.6,0.9]].map(([dx,h])=>rect(cx+r*dx-r*0.18,cy+r*0.75-r*h,r*0.36,r*h,s,1.5)).join(''),
  // Computing / AI
  matrix: (cx,cy,r,s)=>path(`M ${cx-r*0.7} ${cy-r*0.8} L ${cx-r*0.9} ${cy-r*0.8} L ${cx-r*0.9} ${cy+r*0.8} L ${cx-r*0.7} ${cy+r*0.8}`,s)+path(`M ${cx+r*0.7} ${cy-r*0.8} L ${cx+r*0.9} ${cy-r*0.8} L ${cx+r*0.9} ${cy+r*0.8} L ${cx+r*0.7} ${cy+r*0.8}`,s)+[[-0.35,-0.35],[0.35,-0.35],[-0.35,0.35],[0.35,0.35]].map(([dx,dy])=>circle(cx+r*dx,cy+r*dy,r*0.1,s,s)).join(''),
  agent: (cx,cy,r,s)=>circle(cx,cy-r*0.35,r*0.35,s)+path(`M ${cx-r*0.65} ${cy+r*0.7} A ${r*0.65} ${r*0.5} 0 0 1 ${cx+r*0.65} ${cy+r*0.7}`,s)+circle(cx,cy,r*0.95,s,'none',1.4),
  server: (cx,cy,r,s)=>rect(cx-r*0.75,cy-r*0.75,r*1.5,r*0.55,s,1.5)+circle(cx+r*0.45,cy-r*0.48,r*0.08,s,s)+rect(cx-r*0.75,cy+r*0.05,r*1.5,r*0.55,s,1.5)+circle(cx+r*0.45,cy+r*0.32,r*0.08,s,s),
  file: (cx,cy,r,s)=>path(`M ${cx-r*0.55} ${cy-r*0.8} L ${cx+r*0.2} ${cy-r*0.8} L ${cx+r*0.55} ${cy-r*0.45} L ${cx+r*0.55} ${cy+r*0.8} L ${cx-r*0.55} ${cy+r*0.8} Z`,s)+path(`M ${cx+r*0.2} ${cy-r*0.8} L ${cx+r*0.2} ${cy-r*0.45} L ${cx+r*0.55} ${cy-r*0.45}`,s,'none',1.6),
  image: (cx,cy,r,s)=>rect(cx-r*0.85,cy-r*0.65,r*1.7,r*1.3,s,3)+circle(cx-r*0.35,cy-r*0.2,r*0.18,s)+path(`M ${cx-r*0.7} ${cy+r*0.55} L ${cx-r*0.15} ${cy} L ${cx+r*0.25} ${cy+r*0.4} L ${cx+r*0.55} ${cy+r*0.1} L ${cx+r*0.7} ${cy+r*0.25} L ${cx+r*0.7} ${cy+r*0.55} Z`,s,'none',1.8),
  request: (cx,cy,r,s)=>line(cx-r*0.75,cy,cx+r*0.45,cy,s)+path(`M ${cx+r*0.15} ${cy-r*0.35} L ${cx+r*0.45} ${cy} L ${cx+r*0.15} ${cy+r*0.35}`,s),
  response: (cx,cy,r,s)=>line(cx+r*0.75,cy,cx-r*0.45,cy,s)+path(`M ${cx-r*0.15} ${cy-r*0.35} L ${cx-r*0.45} ${cy} L ${cx-r*0.15} ${cy+r*0.35}`,s),
  // Learning
  idea: (cx,cy,r,s)=>circle(cx,cy-r*0.15,r*0.5,s)+line(cx-r*0.22,cy+r*0.55,cx+r*0.22,cy+r*0.55,s,1.8)+line(cx-r*0.15,cy+r*0.78,cx+r*0.15,cy+r*0.78,s,1.6)+[-0.9,-0.5].map(a=>line(cx+r*Math.cos(a*Math.PI)*0.9,cy-r*0.15+r*Math.sin(a*Math.PI)*0.9,cx+r*Math.cos(a*Math.PI)*1.15,cy-r*0.15+r*Math.sin(a*Math.PI)*1.15,s,1.6)).join(''),
  teacher: (cx,cy,r,s)=>circle(cx-r*0.3,cy-r*0.4,r*0.3,s)+path(`M ${cx-r*0.75} ${cy+r*0.65} A ${r*0.45} ${r*0.4} 0 0 1 ${cx+r*0.15} ${cy+r*0.65}`,s)+rect(cx+r*0.15,cy-r*0.15,r*0.7,r*0.55,s,1.5),
  student: (cx,cy,r,s)=>circle(cx,cy-r*0.45,r*0.32,s)+path(`M ${cx-r*0.5} ${cy+r*0.7} A ${r*0.5} ${r*0.45} 0 0 1 ${cx+r*0.5} ${cy+r*0.7}`,s)+rect(cx-r*0.55,cy-r*0.9,r*0.4,r*0.28,s,1)+line(cx-r*0.55,cy-r*0.76,cx-r*0.15,cy-r*0.76,s,1.4),
  book: (cx,cy,r,s)=>path(`M ${cx} ${cy-r*0.6} C ${cx-r*0.35} ${cy-r*0.85} ${cx-r*0.85} ${cy-r*0.8} ${cx-r*0.85} ${cy-r*0.6} L ${cx-r*0.85} ${cy+r*0.7} C ${cx-r*0.35} ${cy+r*0.5} ${cx-r*0.2} ${cy+r*0.55} ${cx} ${cy+r*0.75}`,s)+path(`M ${cx} ${cy-r*0.6} C ${cx+r*0.35} ${cy-r*0.85} ${cx+r*0.85} ${cy-r*0.8} ${cx+r*0.85} ${cy-r*0.6} L ${cx+r*0.85} ${cy+r*0.7} C ${cx+r*0.35} ${cy+r*0.5} ${cx+r*0.2} ${cy+r*0.55} ${cx} ${cy+r*0.75}`,s),
  example: (cx,cy,r,s)=>circle(cx,cy,r*0.9,s)+circle(cx,cy,r*0.5,s,'none',1.8)+circle(cx,cy,r*0.14,s,s),
  result: (cx,cy,r,s)=>line(cx-r*0.6,cy-r*0.85,cx-r*0.6,cy+r*0.85,s)+path(`M ${cx-r*0.6} ${cy-r*0.8} L ${cx+r*0.75} ${cy-r*0.55} L ${cx-r*0.6} ${cy-r*0.15} Z`,s,'none',2),
  // Math / science
  equation: (cx,cy,r,s)=>line(cx-r*0.6,cy-r*0.2,cx+r*0.6,cy-r*0.2,s,2.2)+line(cx-r*0.6,cy+r*0.2,cx+r*0.6,cy+r*0.2,s,2.2),
  probability: (cx,cy,r,s)=>circle(cx,cy,r*0.85,s)+path(`M ${cx} ${cy} L ${cx} ${cy-r*0.85} A ${r*0.85} ${r*0.85} 0 0 1 ${cx+r*0.75} ${cy+r*0.4} Z`,s,s+'55',1.6),
  atom: (cx,cy,r,s)=>circle(cx,cy,r*0.16,s,s)+`<ellipse cx="${cx}" cy="${cy}" rx="${r*0.9}" ry="${r*0.35}" stroke="${s}" stroke-width="1.8" fill="none"/>`+`<ellipse cx="${cx}" cy="${cy}" rx="${r*0.9}" ry="${r*0.35}" stroke="${s}" stroke-width="1.8" fill="none" transform="rotate(60 ${cx} ${cy})"/>`+`<ellipse cx="${cx}" cy="${cy}" rx="${r*0.9}" ry="${r*0.35}" stroke="${s}" stroke-width="1.8" fill="none" transform="rotate(120 ${cx} ${cy})"/>`,
  cell: (cx,cy,r,s)=>circle(cx,cy,r*0.9,s)+circle(cx-r*0.1,cy,r*0.3,s)+[[0.45,-0.35],[-0.5,0.4],[0.3,0.5]].map(([dx,dy])=>circle(cx+r*dx,cy+r*dy,r*0.08,s,s)).join(''),
  energy: (cx,cy,r,s)=>`<path d="M ${cx+r*0.15} ${cy-r*0.9} L ${cx-r*0.4} ${cy+r*0.05} L ${cx+r*0.05} ${cy+r*0.05} L ${cx-r*0.15} ${cy+r*0.9} L ${cx+r*0.45} ${cy-r*0.15} L ${cx} ${cy-r*0.15} Z" stroke="${s}" stroke-width="2" fill="none" stroke-linejoin="round"/>`,
  // General process
  input: (cx,cy,r,s)=>line(cx-r*0.85,cy-r*0.5,cx-r*0.85,cy+r*0.5,s,2)+line(cx-r*0.85,cy,cx+r*0.55,cy,s)+path(`M ${cx+r*0.25} ${cy-r*0.35} L ${cx+r*0.55} ${cy} L ${cx+r*0.25} ${cy+r*0.35}`,s),
  process: (cx,cy,r,s)=>circle(cx,cy,r*0.45,s)+[0,60,120,180,240,300].map(a=>{const rad=a*Math.PI/180;const x1=cx+Math.cos(rad)*r*0.5,y1=cy+Math.sin(rad)*r*0.5,x2=cx+Math.cos(rad)*r*0.85,y2=cy+Math.sin(rad)*r*0.85;return line(x1,y1,x2,y2,s,2.4);}).join(''),
  output: (cx,cy,r,s)=>line(cx+r*0.85,cy-r*0.5,cx+r*0.85,cy+r*0.5,s,2)+line(cx+r*0.85,cy,cx-r*0.55,cy,s)+path(`M ${cx-r*0.25} ${cy-r*0.35} L ${cx-r*0.55} ${cy} L ${cx-r*0.25} ${cy+r*0.35}`,s),
  loop: (cx,cy,r,s)=>`<path d="M ${cx+r*0.75} ${cy} A ${r*0.75} ${r*0.75} 0 1 0 ${cx} ${cy+r*0.75}" stroke="${s}" stroke-width="2.2" fill="none"/>`+path(`M ${cx-r*0.25} ${cy+r*0.5} L ${cx} ${cy+r*0.75} L ${cx+r*0.25} ${cy+r*0.5}`,s,'none',1.8),
  choice: (cx,cy,r,s)=>line(cx-r*0.7,cy-r*0.7,cx,cy,s)+line(cx,cy,cx+r*0.65,cy-r*0.45,s)+line(cx,cy,cx+r*0.65,cy+r*0.45,s)+circle(cx-r*0.7,cy-r*0.7,r*0.1,s,s),
  // Forces and opposition — visually mirrored pair, never interchangeable.
  attract: (cx,cy,r,s)=>line(cx-r*0.85,cy,cx-r*0.15,cy,s)+path(`M ${cx-r*0.45} ${cy-r*0.35} L ${cx-r*0.15} ${cy} L ${cx-r*0.45} ${cy+r*0.35}`,s)+line(cx+r*0.85,cy,cx+r*0.15,cy,s)+path(`M ${cx+r*0.45} ${cy-r*0.35} L ${cx+r*0.15} ${cy} L ${cx+r*0.45} ${cy+r*0.35}`,s),
  repel: (cx,cy,r,s)=>line(cx-r*0.15,cy,cx-r*0.85,cy,s)+path(`M ${cx-r*0.55} ${cy-r*0.35} L ${cx-r*0.85} ${cy} L ${cx-r*0.55} ${cy+r*0.35}`,s)+line(cx+r*0.15,cy,cx+r*0.85,cy,s)+path(`M ${cx+r*0.55} ${cy-r*0.35} L ${cx+r*0.85} ${cy} L ${cx+r*0.55} ${cy+r*0.35}`,s),
  // Objects and measures
  note: (cx,cy,r,s)=>path(`M ${cx-r*0.55} ${cy-r*0.8} L ${cx+r*0.3} ${cy-r*0.8} L ${cx+r*0.55} ${cy-r*0.55} L ${cx+r*0.55} ${cy+r*0.8} L ${cx-r*0.55} ${cy+r*0.8} Z`,s)+path(`M ${cx+r*0.3} ${cy-r*0.8} L ${cx+r*0.3} ${cy-r*0.5} L ${cx+r*0.55} ${cy-r*0.5}`,s,'none',1.6)+line(cx-r*0.3,cy-r*0.2,cx+r*0.3,cy-r*0.2,s,1.6)+line(cx-r*0.3,cy+r*0.15,cx+r*0.3,cy+r*0.15,s,1.6),
  tool: (cx,cy,r,s)=>circle(cx-r*0.35,cy-r*0.35,r*0.42,s)+path(`M ${cx-r*0.35+r*0.3} ${cy-r*0.35+r*0.3} L ${cx+r*0.7} ${cy+r*0.7}`,s)+path(`M ${cx-r*0.62} ${cy-r*0.08} A ${r*0.42} ${r*0.42} 0 0 1 ${cx-r*0.08} ${cy-r*0.62}`,s,'none',1.8),
  cycle: (cx,cy,r,s)=>`<path d="M ${cx} ${cy-r*0.8} A ${r*0.8} ${r*0.8} 0 1 1 ${cx-r*0.05} ${cy-r*0.8}" stroke="${s}" stroke-width="2.2" fill="none"/>`+path(`M ${cx-r*0.35} ${cy-r*0.95} L ${cx-r*0.02} ${cy-r*0.78} L ${cx-r*0.3} ${cy-r*0.55}`,s,'none',1.8)+`<path d="M ${cx} ${cy+r*0.8} A ${r*0.8} ${r*0.8} 0 1 1 ${cx+r*0.05} ${cy+r*0.8}" stroke="${s}" stroke-width="2.2" fill="none"/>`+path(`M ${cx+r*0.35} ${cy+r*0.95} L ${cx+r*0.02} ${cy+r*0.78} L ${cx+r*0.3} ${cy+r*0.55}`,s,'none',1.8),
  light: (cx,cy,r,s)=>circle(cx,cy-r*0.1,r*0.42,s)+path(`M ${cx-r*0.25} ${cy+r*0.45} L ${cx+r*0.25} ${cy+r*0.45} L ${cx+r*0.15} ${cy+r*0.7} L ${cx-r*0.15} ${cy+r*0.7} Z`,s,'none',1.8)+[-60,0,60].map(a=>{const rad=(a-90)*Math.PI/180;return line(cx+Math.cos(rad)*r*0.62,cy-r*0.1+Math.sin(rad)*r*0.62,cx+Math.cos(rad)*r*0.88,cy-r*0.1+Math.sin(rad)*r*0.88,s,1.8);}).join(''),
  temperature: (cx,cy,r,s)=>path(`M ${cx-r*0.22} ${cy+r*0.35} L ${cx-r*0.22} ${cy-r*0.5} A ${r*0.22} ${r*0.22} 0 0 1 ${cx+r*0.22} ${cy-r*0.5} L ${cx+r*0.22} ${cy+r*0.35} Z`,s)+circle(cx,cy+r*0.4,r*0.32,s)+circle(cx,cy+r*0.4,r*0.12,s,s),
  molecule: (cx,cy,r,s)=>circle(cx,cy,r*0.24,s)+circle(cx-r*0.55,cy-r*0.4,r*0.18,s)+circle(cx+r*0.55,cy-r*0.35,r*0.18,s)+circle(cx,cy+r*0.6,r*0.18,s)+line(cx-r*0.2,cy-r*0.1,cx-r*0.42,cy-r*0.3,s,1.6)+line(cx+r*0.2,cy-r*0.1,cx+r*0.42,cy-r*0.28,s,1.6)+line(cx,cy+r*0.2,cx,cy+r*0.45,s,1.6),
  // Objects and systems (each also has a full illustration)
  plant: (cx,cy,r,s)=>path(`M ${cx-r*0.35} ${cy+r*0.1} L ${cx+r*0.35} ${cy+r*0.1} L ${cx+r*0.22} ${cy+r*0.8} L ${cx-r*0.22} ${cy+r*0.8} Z`,s)+line(cx,cy+r*0.1,cx,cy-r*0.45,s,2)+path(`M ${cx} ${cy-r*0.1} C ${cx-r*0.5} ${cy-r*0.15} ${cx-r*0.55} ${cy-r*0.55} ${cx-r*0.6} ${cy-r*0.6}`,s,'none',1.8)+path(`M ${cx} ${cy-r*0.25} C ${cx+r*0.5} ${cy-r*0.3} ${cx+r*0.55} ${cy-r*0.6} ${cx+r*0.6} ${cy-r*0.65}`,s,'none',1.8),
  sun: (cx,cy,r,s)=>circle(cx,cy,r*0.42,s)+[-90,-45,0,45,90,135,180,225].map(a=>{const rad=a*Math.PI/180;return line(cx+Math.cos(rad)*r*0.6,cy+Math.sin(rad)*r*0.6,cx+Math.cos(rad)*r*0.88,cy+Math.sin(rad)*r*0.88,s,1.8);}).join(''),
  browser: (cx,cy,r,s)=>rect(cx-r*0.85,cy-r*0.6,r*1.7,r*1.2,s,3)+line(cx-r*0.85,cy-r*0.2,cx+r*0.85,cy-r*0.2,s,1.8)+circle(cx-r*0.6,cy-r*0.4,r*0.07,s,s)+circle(cx-r*0.38,cy-r*0.4,r*0.07,s,s)+line(cx-r*0.6,cy+r*0.1,cx+r*0.55,cy+r*0.1,s,1.6)+line(cx-r*0.6,cy+r*0.35,cx+r*0.1,cy+r*0.35,s,1.6),
  phone: (cx,cy,r,s)=>rect(cx-r*0.45,cy-r*0.8,r*0.9,r*1.6,s,3)+line(cx-r*0.15,cy-r*0.62,cx+r*0.15,cy-r*0.62,s,1.8)+circle(cx,cy+r*0.55,r*0.07,s,s),
  robot: (cx,cy,r,s)=>path(`M ${cx-r*0.55} ${cy-r*0.1} A ${r*0.55} ${r*0.55} 0 0 1 ${cx+r*0.55} ${cy-r*0.1} L ${cx+r*0.55} ${cy+r*0.15} L ${cx-r*0.55} ${cy+r*0.15} Z`,s)+circle(cx-r*0.2,cy-r*0.25,r*0.08,s,s)+circle(cx+r*0.2,cy-r*0.25,r*0.08,s,s)+line(cx,cy-r*0.65,cx,cy-r*0.9,s,1.8)+circle(cx,cy-r*0.9,r*0.06,s,s)+rect(cx-r*0.45,cy+r*0.15,r*0.9,r*0.6,s,2),
  pipeline: (cx,cy,r,s)=>rect(cx-r*0.85,cy-r*0.3,r*0.45,r*0.6,s,2)+rect(cx-r*0.2,cy-r*0.3,r*0.45,r*0.6,s,2)+rect(cx+r*0.45,cy-r*0.3,r*0.4,r*0.6,s,2)+line(cx-r*0.4,cy,cx-r*0.2,cy,s,1.8)+line(cx+r*0.25,cy,cx+r*0.45,cy,s,1.8),
};
export function renderIcon(kind:NodeKind|undefined,cx:number,cy:number,r:number,stroke:string):string {
  const fn=kind&&ICONS[kind];
  return fn?`<g>${fn(cx,cy,r,stroke)}</g>`:'';
}
export function hasIcon(kind?:NodeKind):boolean { return !!(kind && kind!=='generic' && ICONS[kind]); }
