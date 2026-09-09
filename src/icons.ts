import type {NodeKind} from './vocabulary.js';
import {STROKE} from './style.js';
/** Small, deterministic glyphs drawn as if by one hand on one whiteboard. Each renderer
 *  draws inside a circle of radius r centered at (cx, cy) and works in *normalized* units
 *  (-1..1 of r) via the Draw helper, so a glyph reads identically at the 15px inline size
 *  the engine uses inside boxes and at the ~40px hero size of a standalone icon node.
 *
 *  Weights come from STROKE.icon (style.ts) and scale with r: three tiers only — W (major
 *  silhouette), D (secondary detail), F (fine hatching/text lines). Nothing hardcodes a
 *  colour: `stroke` is the caller's per-kind accent, PAPER is the board itself, used only
 *  to knock a shape out of the one behind it. */
type IconFn = (cx:number, cy:number, r:number, stroke:string) => string;

const PAPER = '#fffef9';
const clamp=(v:number,lo:number,hi:number)=>v<lo?lo:v>hi?hi:v;
const num=(v:number)=>Math.round(v*1000)/1000;

interface Draw {
  /** normalized point -> "x y" for path data */
  P:(dx:number,dy:number)=>string;
  ln:(x1:number,y1:number,x2:number,y2:number,w?:number)=>string;
  ci:(dx:number,dy:number,rad:number,w?:number,fill?:string)=>string;
  /** centered rounded rect: half-width hw, half-height hh */
  re:(dx:number,dy:number,hw:number,hh:number,rx?:number,w?:number,fill?:string)=>string;
  el:(dx:number,dy:number,rx:number,ry:number,w?:number)=>string;
  pa:(d:string,w?:number,fill?:string)=>string;
  dot:(dx:number,dy:number,rad?:number)=>string;
  W:number; D:number; F:number; s:string;
}
function draw(cx:number,cy:number,r:number,s:string):Draw {
  const W=clamp(STROKE.icon*r/20,1.7,3.2), D=W*0.72, F=W*0.56;
  const X=(d:number)=>num(cx+d*r), Y=(d:number)=>num(cy+d*r), R=(d:number)=>num(Math.abs(d)*r);
  const cap=' stroke-linecap="round" stroke-linejoin="round"';
  return {
    W,D,F,s,
    P:(dx,dy)=>`${X(dx)} ${Y(dy)}`,
    ln:(x1,y1,x2,y2,w=W)=>`<line x1="${X(x1)}" y1="${Y(y1)}" x2="${X(x2)}" y2="${Y(y2)}" stroke="${s}" stroke-width="${num(w)}" stroke-linecap="round"/>`,
    ci:(dx,dy,rad,w=W,fill='none')=>`<circle cx="${X(dx)}" cy="${Y(dy)}" r="${R(rad)}" stroke="${s}" stroke-width="${num(w)}" fill="${fill}"/>`,
    re:(dx,dy,hw,hh,rx=0.08,w=W,fill='none')=>`<rect x="${X(dx-hw)}" y="${Y(dy-hh)}" width="${R(hw*2)}" height="${R(hh*2)}" rx="${R(rx)}" stroke="${s}" stroke-width="${num(w)}" fill="${fill}"/>`,
    el:(dx,dy,rx,ry,w=W)=>`<ellipse cx="${X(dx)}" cy="${Y(dy)}" rx="${R(rx)}" ry="${R(ry)}" stroke="${s}" stroke-width="${num(w)}" fill="none"/>`,
    pa:(d,w=W,fill='none')=>`<path d="${d}" stroke="${s}" stroke-width="${num(w)}" fill="${fill}"${cap}/>`,
    dot:(dx,dy,rad=0.09)=>`<circle cx="${X(dx)}" cy="${Y(dy)}" r="${R(rad)}" fill="${s}"/>`,
  };
}
const glyph=(fn:(g:Draw)=>string):IconFn=>(cx,cy,r,s)=>fn(draw(cx,cy,r,s));

/** A person seen from the front: head, neck notch, shoulders. Shared so every human-ish
 *  glyph (user, agent, teacher, student) is unmistakably the same character. */
function bust(g:Draw,dx:number,dy:number,scale:number):string {
  const P=(a:number,b:number)=>g.P(dx+a*scale,dy+b*scale);
  return g.ci(dx,dy-0.34*scale,0.34*scale)
    +g.pa(`M ${P(-0.72,0.78)} C ${P(-0.7,0.16)} ${P(0.7,0.16)} ${P(0.72,0.78)}`,g.W)
    +g.pa(`M ${P(-0.19,0.11)} L ${P(0,0.3)} L ${P(0.19,0.11)}`,g.D);
}
/** Chevron arrowhead pointing along (ux,uy) at tip (tx,ty), in normalized units. */
function head(g:Draw,tx:number,ty:number,ux:number,uy:number,size=0.3,w?:number):string {
  const nx=-uy, ny=ux;
  return g.pa(`M ${g.P(tx-ux*size+nx*size*0.78,ty-uy*size+ny*size*0.78)} L ${g.P(tx,ty)} L ${g.P(tx-ux*size-nx*size*0.78,ty-uy*size-ny*size*0.78)}`,w??g.W);
}

const ICONS: Partial<Record<NodeKind, IconFn>> = {
  // A drawn question mark (not a font glyph) inside a thinking bubble: hook, stem, dot.
  question: glyph(g=>g.ci(0,0,0.95,g.W)
    +g.pa(`M ${g.P(-0.34,-0.32)} C ${g.P(-0.36,-0.78)} ${g.P(0.42,-0.8)} ${g.P(0.34,-0.34)} C ${g.P(0.28,-0.02)} ${g.P(0.02,0.02)} ${g.P(0.02,0.3)}`,g.W)
    +g.dot(0.02,0.6,0.1)),
  // Bow (with its own hole), shaft, two teeth of different depth — a real key silhouette.
  key: glyph(g=>g.ci(-0.5,-0.02,0.4,g.W)+g.ci(-0.5,-0.02,0.14,g.D)
    +g.ln(-0.12,-0.02,0.86,-0.02,g.W)
    +g.ln(0.34,-0.02,0.34,0.32,g.D)
    +g.ln(0.62,-0.02,0.62,0.42,g.D)
    +g.ln(0.86,-0.02,0.86,0.2,g.D)),
  // Crate: lid seam plus corner banding so it reads as a shipping container, not a box.
  container: glyph(g=>g.re(0,0,0.82,0.62,0.08,g.W)
    +g.ln(-0.82,-0.24,0.82,-0.24,g.D)
    +g.ln(-0.36,-0.24,-0.36,0.62,g.F)+g.ln(0.36,-0.24,0.36,0.62,g.F)
    +g.ln(-0.22,-0.62,-0.22,-0.24,g.F)+g.ln(0.22,-0.62,0.22,-0.24,g.F)),
  // Three-ring cylinder: top platter, two stacked ring seams, skirt.
  database: glyph(g=>g.el(0,-0.6,0.72,0.26,g.W)
    +g.ln(-0.72,-0.6,-0.72,0.62,g.W)+g.ln(0.72,-0.6,0.72,0.62,g.W)
    +g.pa(`M ${g.P(-0.72,-0.2)} A ${num(0.72)} ${num(0.26)} 0 0 0 ${g.P(0.72,-0.2)}`.replace(/A 0.72 0.26/,`A ${g.P(0,0)!==''?'':''}`)==='' ? '' : `M ${g.P(-0.72,-0.2)} A ${g.P(0,0).split(' ')[0]} 0 0 0 0`,g.D)
    +g.pa(`M ${g.P(-0.72,0.62)} C ${g.P(-0.72,0.9)} ${g.P(0.72,0.9)} ${g.P(0.72,0.62)}`,g.W)
    +g.pa(`M ${g.P(-0.72,-0.2)} C ${g.P(-0.72,0.08)} ${g.P(0.72,0.08)} ${g.P(0.72,-0.2)}`,g.D)
    +g.pa(`M ${g.P(-0.72,0.21)} C ${g.P(-0.72,0.49)} ${g.P(0.72,0.49)} ${g.P(0.72,0.21)}`,g.D)),
  // Three-layer net: input, hidden, output, fully connected — a model, not a triangle.
  model: glyph(g=>{
    const L1:[number,number][]=[[-0.72,-0.44],[-0.72,0.44]];
    const L2:[number,number][]=[[0,-0.66],[0,0],[0,0.66]];
    const L3:[number,number][]=[[0.72,-0.22],[0.72,0.34]];
    let out='';
    for(const a of L1) for(const b of L2) out+=g.ln(a[0],a[1],b[0],b[1],g.F);
    for(const a of L2) for(const b of L3) out+=g.ln(a[0],a[1],b[0],b[1],g.F);
    for(const [x,y] of [...L1,...L2,...L3]) out+=g.ci(x,y,0.15,g.D,PAPER);
    return out;
  }),
  user: glyph(g=>bust(g,0,-0.06,1)),
  // Page with a folded corner and ruled text.
  document: glyph(g=>g.pa(`M ${g.P(-0.56,-0.84)} L ${g.P(0.2,-0.84)} L ${g.P(0.56,-0.46)} L ${g.P(0.56,0.84)} L ${g.P(-0.56,0.84)} Z`,g.W)
    +g.pa(`M ${g.P(0.2,-0.84)} L ${g.P(0.2,-0.46)} L ${g.P(0.56,-0.46)}`,g.D)
    +g.ln(-0.32,-0.14,0.32,-0.14,g.F)+g.ln(-0.32,0.18,0.32,0.18,g.F)+g.ln(-0.32,0.5,0.08,0.5,g.F)),
  // Curly braces around a payload of three dots: the shape of an interface.
  api: glyph(g=>g.pa(`M ${g.P(-0.34,-0.82)} C ${g.P(-0.62,-0.82)} ${g.P(-0.52,-0.2)} ${g.P(-0.8,-0.04)} C ${g.P(-0.52,0.12)} ${g.P(-0.62,0.74)} ${g.P(-0.34,0.74)}`,g.W)
    +g.pa(`M ${g.P(0.34,-0.82)} C ${g.P(0.62,-0.82)} ${g.P(0.52,-0.2)} ${g.P(0.8,-0.04)} C ${g.P(0.52,0.12)} ${g.P(0.62,0.74)} ${g.P(0.34,0.74)}`,g.W)
    +g.dot(-0.26,-0.04,0.1)+g.dot(0,-0.04,0.1)+g.dot(0.26,-0.04,0.1)),
  // Real cumulus silhouette: three bumps over a flat base, drawn as one closed outline.
  cloud: glyph(g=>g.pa(`M ${g.P(-0.78,0.44)} C ${g.P(-0.98,0.06)} ${g.P(-0.72,-0.3)} ${g.P(-0.42,-0.22)} C ${g.P(-0.38,-0.72)} ${g.P(0.24,-0.78)} ${g.P(0.3,-0.34)} C ${g.P(0.62,-0.52)} ${g.P(0.9,-0.2)} ${g.P(0.76,0.1)} C ${g.P(0.96,0.2)} ${g.P(0.92,0.44)} ${g.P(0.74,0.44)} Z`,g.W)),
  // Memory chip: die, inner core, pins on all four sides.
  memory: glyph(g=>{
    let out=g.re(0,0,0.5,0.5,0.06,g.W)+g.re(0,0,0.24,0.24,0.04,g.D);
    for(const t of [-0.26,0,0.26]){
      out+=g.ln(t,-0.5,t,-0.8,g.D)+g.ln(t,0.5,t,0.8,g.D)
        +g.ln(-0.5,t,-0.8,t,g.D)+g.ln(0.5,t,0.8,t,g.D);
    }
    return out;
  }),
  // Magnifier: lens, glint, thick grip.
  search: glyph(g=>g.ci(-0.16,-0.16,0.56,g.W)
    +g.pa(`M ${g.P(-0.46,-0.28)} A ${num(0.34)} ${num(0.34)} 0 0 1 ${g.P(-0.28,-0.5)}`.length?`M ${g.P(-0.44,-0.3)} C ${g.P(-0.44,-0.5)} ${g.P(-0.34,-0.56)} ${g.P(-0.2,-0.58)}`:'',g.F)
    +g.ln(0.26,0.26,0.74,0.74,g.W*1.15)),
  // Vector: arrow off the origin with its component ticks.
  vector: glyph(g=>g.ln(-0.78,0.72,-0.78,-0.6,g.F)+g.ln(-0.78,0.72,0.62,0.72,g.F)
    +g.ln(-0.78,0.72,0.56,-0.5,g.W)+head(g,0.56,-0.5,0.74,-0.67,0.3,g.W)
    +g.dot(-0.78,0.72,0.11)
    +g.ln(0.56,-0.5,0.56,0.72,g.F)),
  // Text token: a rounded chip with two clipped word-strokes inside.
  token: glyph(g=>g.re(0,0,0.78,0.44,0.42,g.W)
    +g.ln(-0.46,-0.08,0.1,-0.08,g.F)+g.ln(-0.46,0.16,0.34,0.16,g.F)),
  // Two lobes with folds and a stem.
  brain: glyph(g=>g.pa(`M ${g.P(-0.04,-0.7)} C ${g.P(-0.88,-0.72)} ${g.P(-0.9,0.72)} ${g.P(-0.04,0.7)}`,g.W)
    +g.pa(`M ${g.P(0.04,-0.7)} C ${g.P(0.88,-0.72)} ${g.P(0.9,0.72)} ${g.P(0.04,0.7)}`,g.W)
    +g.ln(0,-0.66,0,0.66,g.D)
    +g.pa(`M ${g.P(-0.04,-0.34)} C ${g.P(-0.36,-0.34)} ${g.P(-0.34,-0.02)} ${g.P(-0.6,-0.02)}`,g.F)
    +g.pa(`M ${g.P(-0.04,0.3)} C ${g.P(-0.34,0.3)} ${g.P(-0.36,0.5)} ${g.P(-0.56,0.5)}`,g.F)
    +g.pa(`M ${g.P(0.04,-0.34)} C ${g.P(0.36,-0.34)} ${g.P(0.34,-0.02)} ${g.P(0.6,-0.02)}`,g.F)
    +g.pa(`M ${g.P(0.04,0.3)} C ${g.P(0.34,0.3)} ${g.P(0.36,0.5)} ${g.P(0.56,0.5)}`,g.F)),
  // Padlock with a keyhole.
  lock: glyph(g=>g.re(0,0.38,0.56,0.44,0.1,g.W)
    +g.pa(`M ${g.P(-0.34,-0.06)} L ${g.P(-0.34,-0.4)} A ${num(0.34)} ${num(0.34)} 0 0 1 ${g.P(0.34,-0.4)} L ${g.P(0.34,-0.06)}`,g.W)
    +g.ci(0,0.3,0.11,g.D)+g.ln(0,0.4,0,0.58,g.D)),
  // Triangle + drawn bang (stroke, not text) so it renders the same without a font.
  warning: glyph(g=>g.pa(`M ${g.P(0,-0.86)} L ${g.P(0.88,0.62)} L ${g.P(-0.88,0.62)} Z`,g.W)
    +g.ln(0,-0.36,0,0.16,g.W)+g.dot(0,0.42,0.1)),
  success: glyph(g=>g.ci(0,0,0.94,g.W)
    +g.pa(`M ${g.P(-0.46,0.02)} L ${g.P(-0.12,0.4)} L ${g.P(0.5,-0.4)}`,g.W*1.1)),
  // Bar chart on axes with a rising trend line.
  graph: glyph(g=>{
    let out=g.pa(`M ${g.P(-0.84,-0.78)} L ${g.P(-0.84,0.78)} L ${g.P(0.84,0.78)}`,g.D);
    const bars:[number,number][]=[[-0.5,0.34],[-0.02,0.68],[0.46,1.06]];
    for(const [x,h] of bars) out+=g.re(x,0.78-h/2,0.17,h/2,0.04,g.W);
    return out;
  }),
  // Computing / AI
  // Bracketed grid of values.
  matrix: glyph(g=>g.pa(`M ${g.P(-0.66,-0.8)} L ${g.P(-0.88,-0.8)} L ${g.P(-0.88,0.8)} L ${g.P(-0.66,0.8)}`,g.W)
    +g.pa(`M ${g.P(0.66,-0.8)} L ${g.P(0.88,-0.8)} L ${g.P(0.88,0.8)} L ${g.P(0.66,0.8)}`,g.W)
    +[-0.38,0.38].flatMap(y=>[-0.36,0.36].map(x=>g.dot(x,y,0.1))).join('')
    +g.ln(-0.36,0,0.36,0,g.F)),
  // A person inside an orbiting ring with a live node on it: autonomous actor.
  agent: glyph(g=>g.ci(0,0,0.96,g.D)+bust(g,0,-0.1,0.78)+g.ci(0.68,-0.68,0.13,g.D,PAPER)),
  // Three rack units with LEDs and vent slots.
  server: glyph(g=>{
    let out='';
    for(const y of [-0.48,0,0.48]){
      out+=g.re(0,y,0.66,0.2,0.05,g.W)
        +g.ln(-0.5,y,-0.16,y,g.F)
        +g.dot(0.44,y,0.07)+g.ci(0.24,y,0.07,g.F);
    }
    return out;
  }),
  // Folder with a tab — distinct from `document`'s single page.
  file: glyph(g=>g.pa(`M ${g.P(-0.82,0.66)} L ${g.P(-0.82,-0.58)} L ${g.P(-0.2,-0.58)} L ${g.P(-0.02,-0.34)} L ${g.P(0.82,-0.34)} L ${g.P(0.82,0.66)} Z`,g.W)
    +g.ln(-0.82,-0.06,0.82,-0.06,g.D)),
  // Framed photo: sun and mountain range.
  image: glyph(g=>g.re(0,0,0.84,0.64,0.09,g.W)
    +g.ci(-0.42,-0.28,0.14,g.D)
    +g.pa(`M ${g.P(-0.84,0.5)} L ${g.P(-0.22,-0.08)} L ${g.P(0.18,0.28)} L ${g.P(0.46,0.02)} L ${g.P(0.84,0.4)}`,g.D)),
  // Packet leaving on a rightward arrow (mirror of response — never interchangeable).
  request: glyph(g=>g.re(-0.6,0,0.24,0.3,0.07,g.D)
    +g.ln(-0.3,0,0.5,0,g.W)+head(g,0.62,0,1,0,0.28,g.W)
    +g.ln(-0.52,-0.1,-0.52,0.1,g.F)+g.ln(-0.68,-0.1,-0.68,0.1,g.F)),
  response: glyph(g=>g.re(0.6,0,0.24,0.3,0.07,g.D)
    +g.ln(0.3,0,-0.5,0,g.W)+head(g,-0.62,0,-1,0,0.28,g.W)
    +g.ln(0.52,-0.1,0.52,0.1,g.F)+g.ln(0.68,-0.1,0.68,0.1,g.F)),
  // Learning
  // Bulb: glass, filament, screw base, rays.
  idea: glyph(g=>g.pa(`M ${g.P(-0.26,0.4)} C ${g.P(-0.34,0.06)} ${g.P(-0.5,-0.02)} ${g.P(-0.5,-0.26)} C ${g.P(-0.5,-0.62)} ${g.P(0.5,-0.62)} ${g.P(0.5,-0.26)} C ${g.P(0.5,-0.02)} ${g.P(0.34,0.06)} ${g.P(0.26,0.4)} Z`,g.W)
    +g.pa(`M ${g.P(-0.14,-0.06)} L ${g.P(-0.04,-0.24)} L ${g.P(0.06,-0.06)} L ${g.P(0.16,-0.24)}`,g.F)
    +g.ln(-0.24,0.56,0.24,0.56,g.D)+g.ln(-0.18,0.76,0.18,0.76,g.D)
    +[-0.95,-0.72,-0.48].map(a=>{const rad=a*Math.PI;return g.ln(Math.cos(rad)*0.72,-0.2+Math.sin(rad)*0.72,Math.cos(rad)*0.95,-0.2+Math.sin(rad)*0.95,g.F);}).join('')),
  // Instructor beside a board with writing on it.
  teacher: glyph(g=>bust(g,-0.42,-0.06,0.62)
    +g.re(0.42,-0.16,0.46,0.42,0.05,g.W)
    +g.ln(0.1,-0.3,0.62,-0.3,g.F)+g.ln(0.1,-0.08,0.5,-0.08,g.F)
    +g.ln(-0.02,0.16,0.24,-0.04,g.D)),
  // Learner in a mortarboard.
  student: glyph(g=>bust(g,0,0.06,0.78)
    +g.pa(`M ${g.P(-0.72,-0.52)} L ${g.P(0,-0.82)} L ${g.P(0.72,-0.52)} L ${g.P(0,-0.24)} Z`,g.W)
    +g.pa(`M ${g.P(0.56,-0.44)} L ${g.P(0.56,-0.14)}`,g.F)+g.dot(0.56,-0.06,0.08)),
  // Open book with a spine and ruled pages.
  book: glyph(g=>g.pa(`M ${g.P(0,-0.56)} C ${g.P(-0.34,-0.84)} ${g.P(-0.86,-0.8)} ${g.P(-0.86,-0.58)} L ${g.P(-0.86,0.66)} C ${g.P(-0.4,0.46)} ${g.P(-0.2,0.52)} ${g.P(0,0.74)}`,g.W)
    +g.pa(`M ${g.P(0,-0.56)} C ${g.P(0.34,-0.84)} ${g.P(0.86,-0.8)} ${g.P(0.86,-0.58)} L ${g.P(0.86,0.66)} C ${g.P(0.4,0.46)} ${g.P(0.2,0.52)} ${g.P(0,0.74)}`,g.W)
    +g.ln(0,-0.56,0,0.74,g.D)
    +g.ln(-0.66,-0.3,-0.18,-0.2,g.F)+g.ln(-0.66,0.02,-0.18,0.12,g.F)
    +g.ln(0.18,-0.2,0.66,-0.3,g.F)+g.ln(0.18,0.12,0.66,0.02,g.F)),
  // Target: three rings and a hit marker.
  example: glyph(g=>g.ci(0,0,0.9,g.W)+g.ci(0,0,0.54,g.D)+g.ci(0,0,0.18,g.D)+g.dot(0,0,0.09)),
  // Planted flag: pole, ground, pennant.
  result: glyph(g=>g.ln(-0.56,-0.86,-0.56,0.82,g.W)
    +g.ln(-0.82,0.82,-0.16,0.82,g.D)
    +g.pa(`M ${g.P(-0.56,-0.8)} C ${g.P(-0.1,-0.62)} ${g.P(0.36,-0.9)} ${g.P(0.78,-0.7)} L ${g.P(0.78,-0.16)} C ${g.P(0.36,-0.36)} ${g.P(-0.1,-0.08)} ${g.P(-0.56,-0.26)} Z`,g.W)),
  // Math / science
  // "x + y = z" abstracted to strokes: a sum on the left, an equals on the right.
  equation: glyph(g=>g.ln(-0.78,-0.02,-0.34,-0.02,g.W)+g.ln(-0.56,-0.24,-0.56,0.2,g.W)
    +g.ln(-0.1,-0.24,0.24,-0.24,g.W)+g.ln(-0.1,0.2,0.24,0.2,g.W)
    +g.ln(0.5,-0.36,0.82,0.32,g.D)+g.ln(0.82,-0.36,0.5,0.32,g.D)),
  // Pie with one wedge shaded — a probability mass.
  probability: glyph(g=>g.ci(0,0,0.85,g.W)
    +g.pa(`M ${g.P(0,0)} L ${g.P(0,-0.85)} A ${num(0.85)} ${num(0.85)} 0 0 1 ${g.P(0.74,0.42)} Z`,g.D,g.s+'33')
    +g.ln(0,0,-0.74,0.42,g.F)),
  atom: glyph(g=>{
    const rings=[0,60,120].map(a=>`<ellipse cx="${g.P(0,0).split(' ')[0]}" cy="${g.P(0,0).split(' ')[1]}" rx="0" ry="0"/>`);
    void rings;
    return g.dot(0,0,0.16)
      +[0,60,120].map(a=>`<g transform="rotate(${a} ${g.P(0,0)})">${g.el(0,0,0.9,0.34,g.D)}</g>`).join('')
      +g.ci(0.9,0,0.09,g.F,PAPER);
  }),
  cell: glyph(g=>g.ci(0,0,0.9,g.W)+g.ci(-0.12,-0.02,0.32,g.D)+g.dot(-0.12,-0.02,0.1)
    +[[0.46,-0.4],[-0.5,0.42],[0.34,0.5],[0.56,0.16]].map(([x,y])=>g.ci(x,y,0.1,g.F)).join('')),
  // Clean lightning bolt.
  energy: glyph(g=>g.pa(`M ${g.P(0.34,-0.92)} L ${g.P(-0.42,0.06)} L ${g.P(0.02,0.06)} L ${g.P(-0.24,0.92)} L ${g.P(0.5,-0.1)} L ${g.P(0.06,-0.1)} Z`,g.W)),
  // General process
  // Arrow entering a tray (mirror of output).
  input: glyph(g=>g.pa(`M ${g.P(0.3,-0.7)} L ${g.P(0.82,-0.7)} L ${g.P(0.82,0.7)} L ${g.P(0.3,0.7)}`,g.W)
    +g.ln(-0.86,0,0.34,0,g.W)+head(g,0.46,0,1,0,0.28,g.W)),
  // Gear: eight teeth, hub, axle.
  process: glyph(g=>{
    const teeth=8, step=360/teeth, ro=0.95, ri=0.66;
    const pt=(deg:number,rad:number)=>g.P(Math.cos(deg*Math.PI/180)*rad,Math.sin(deg*Math.PI/180)*rad);
    let d='';
    for(let i=0;i<teeth;i++){
      const a=i*step;
      d+=`${i?'L':'M'} ${pt(a-12,ro)} L ${pt(a+12,ro)} L ${pt(a+17,ri)} L ${pt(a+step-17,ri)} `;
    }
    return g.pa(d+'Z',g.W)+g.ci(0,0,0.3,g.D);
  }),
  // Arrow leaving a tray (mirror of input).
  output: glyph(g=>g.pa(`M ${g.P(-0.3,-0.7)} L ${g.P(-0.82,-0.7)} L ${g.P(-0.82,0.7)} L ${g.P(-0.3,0.7)}`,g.W)
    +g.ln(0.86,0,-0.34,0,g.W)+head(g,-0.46,0,-1,0,0.28,g.W)),
  // Almost-closed circular arrow with a repeat tick.
  loop: glyph(g=>g.pa(`M ${g.P(0.28,-0.7)} A ${num(0.76)} ${num(0.76)} 0 1 1 ${g.P(0.74,0.2)}`,g.W)
    +head(g,0.28,-0.7,-0.6,-0.8,0.3,g.D)
    +g.ln(0.74,0.2,0.74,0.5,g.F)),
  // A path that forks: one input, two outcomes.
  choice: glyph(g=>g.ln(-0.86,-0.62,-0.16,-0.62,g.W)
    +g.pa(`M ${g.P(-0.16,-0.62)} C ${g.P(0.18,-0.62)} ${g.P(0.24,-0.62)} ${g.P(0.4,-0.62)}`,g.W)
    +g.pa(`M ${g.P(-0.16,-0.62)} C ${g.P(0.14,-0.62)} ${g.P(0.1,0.56)} ${g.P(0.4,0.56)}`,g.W)
    +head(g,0.66,-0.62,1,0,0.26,g.D)+head(g,0.66,0.56,1,0,0.26,g.D)
    +g.dot(-0.16,-0.62,0.1)),
  // Forces and opposition — visually mirrored pair, never interchangeable.
  attract: glyph(g=>g.ln(-0.9,0,-0.34,0,g.W)+head(g,-0.18,0,1,0,0.3,g.W)
    +g.ln(0.9,0,0.34,0,g.W)+head(g,0.18,0,-1,0,0.3,g.W)
    +g.ln(0,-0.5,0,0.5,g.F)),
  repel: glyph(g=>g.ln(-0.18,0,-0.74,0,g.W)+head(g,-0.9,0,-1,0,0.3,g.W)
    +g.ln(0.18,0,0.74,0,g.W)+head(g,0.9,0,1,0,0.3,g.W)
    +g.ln(0,-0.5,0,0.5,g.F)),
  // Objects and measures
  // Sticky note with a peeled corner and two written lines.
  note: glyph(g=>g.pa(`M ${g.P(-0.7,-0.72)} L ${g.P(0.7,-0.72)} L ${g.P(0.7,0.34)} L ${g.P(0.3,0.72)} L ${g.P(-0.7,0.72)} Z`,g.W)
    +g.pa(`M ${g.P(0.7,0.34)} L ${g.P(0.3,0.34)} L ${g.P(0.3,0.72)}`,g.D)
    +g.ln(-0.44,-0.34,0.44,-0.34,g.F)+g.ln(-0.44,-0.02,0.44,-0.02,g.F)+g.ln(-0.44,0.3,0.02,0.3,g.F)),
  // Wrench crossed over a screwdriver.
  tool: glyph(g=>g.pa(`M ${g.P(-0.86,-0.5)} A ${num(0.34)} ${num(0.34)} 0 1 0 ${g.P(-0.4,-0.86)} L ${g.P(-0.62,-0.64)} L ${g.P(-0.78,-0.72)} L ${g.P(-0.86,-0.88)} Z`.replace(' Z',''),g.W)
    +g.ci(-0.52,-0.52,0.36,g.W)
    +g.ln(-0.26,-0.26,0.72,0.72,g.W)
    +g.pa(`M ${g.P(0.5,0.86)} L ${g.P(0.86,0.5)}`,g.D)),
  // Two arrows chasing each other round a circle.
  cycle: glyph(g=>g.pa(`M ${g.P(0.06,-0.8)} A ${num(0.8)} ${num(0.8)} 0 0 1 ${g.P(0.8,0.06)}`,g.W)+head(g,0.8,0.06,0.3,0.95,0.28,g.D)
    +g.pa(`M ${g.P(0.06,0.8)} A ${num(0.8)} ${num(0.8)} 0 0 1 ${g.P(-0.8,-0.06)}`.replace('0 0 1','0 0 1'),g.W)+head(g,-0.8,-0.06,-0.3,-0.95,0.28,g.D)
    +g.pa(`M ${g.P(-0.06,-0.8)} A ${num(0.8)} ${num(0.8)} 0 0 0 ${g.P(-0.8,0.06)}`,g.F)
    +g.pa(`M ${g.P(-0.06,0.8)} A ${num(0.8)} ${num(0.8)} 0 0 0 ${g.P(0.8,-0.06)}`,g.F)),
  // Desk lamp bulb throwing light.
  light: glyph(g=>g.ci(0,-0.14,0.4,g.W)
    +g.pa(`M ${g.P(-0.24,0.36)} L ${g.P(0.24,0.36)} L ${g.P(0.15,0.62)} L ${g.P(-0.15,0.62)} Z`,g.D)
    +g.ln(-0.15,0.8,0.15,0.8,g.F)
    +[-140,-90,-40,0,180].map(a=>{const rad=a*Math.PI/180;return g.ln(Math.cos(rad)*0.58,-0.14+Math.sin(rad)*0.58,Math.cos(rad)*0.86,-0.14+Math.sin(rad)*0.86,g.F);}).join('')),
  // Thermometer with gradations and a filled bulb.
  temperature: glyph(g=>g.pa(`M ${g.P(-0.2,0.3)} L ${g.P(-0.2,-0.56)} A ${num(0.2)} ${num(0.2)} 0 0 1 ${g.P(0.2,-0.56)} L ${g.P(0.2,0.3)}`,g.W)
    +g.ci(0,0.44,0.3,g.W)+g.dot(0,0.44,0.16)+g.ln(0,0.2,0,0.3,g.D)
    +[-0.36,-0.16,0.04].map(y=>g.ln(0.2,y,0.44,y,g.F)).join('')),
  // Bonded atoms.
  molecule: glyph(g=>g.ln(-0.2,-0.1,-0.44,-0.32,g.F)+g.ln(0.2,-0.1,0.44,-0.3,g.F)+g.ln(0,0.2,0,0.48,g.F)
    +g.ci(0,0,0.26,g.W,PAPER)+g.ci(-0.58,-0.42,0.2,g.D,PAPER)+g.ci(0.58,-0.38,0.2,g.D,PAPER)+g.ci(0,0.62,0.2,g.D,PAPER)),
  // Objects and systems (each also has a full illustration)
  // Potted sprout with two leaves and soil line.
  plant: glyph(g=>g.pa(`M ${g.P(-0.4,0.12)} L ${g.P(0.4,0.12)} L ${g.P(0.24,0.86)} L ${g.P(-0.24,0.86)} Z`,g.W)
    +g.ln(-0.4,0.32,0.4,0.32,g.D)
    +g.ln(0,0.12,0,-0.4,g.W)
    +g.pa(`M ${g.P(0,-0.14)} C ${g.P(-0.36,-0.16)} ${g.P(-0.62,-0.36)} ${g.P(-0.6,-0.66)} C ${g.P(-0.28,-0.62)} ${g.P(-0.04,-0.42)} ${g.P(0,-0.14)} Z`,g.D)
    +g.pa(`M ${g.P(0,-0.3)} C ${g.P(0.32,-0.34)} ${g.P(0.58,-0.5)} ${g.P(0.6,-0.78)} C ${g.P(0.3,-0.76)} ${g.P(0.06,-0.56)} ${g.P(0,-0.3)} Z`,g.D)),
  // Disc plus alternating long/short rays.
  sun: glyph(g=>g.ci(0,0,0.42,g.W)
    +[0,45,90,135,180,225,270,315].map((a,i)=>{const rad=a*Math.PI/180,r2=i%2?0.78:0.9;return g.ln(Math.cos(rad)*0.58,Math.sin(rad)*0.58,Math.cos(rad)*r2,Math.sin(rad)*r2,i%2?g.F:g.D);}).join('')),
  // Window: chrome dots, address pill, content lines.
  browser: glyph(g=>g.re(0,0,0.86,0.66,0.09,g.W)
    +g.ln(-0.86,-0.28,0.86,-0.28,g.D)
    +g.dot(-0.68,-0.47,0.07)+g.dot(-0.48,-0.47,0.07)+g.dot(-0.28,-0.47,0.07)
    +g.re(0.3,-0.47,0.46,0.1,0.1,g.F)
    +g.ln(-0.62,0.06,0.62,0.06,g.F)+g.ln(-0.62,0.34,0.14,0.34,g.F)),
  // Handset: screen inset, earpiece slot, home button.
  phone: glyph(g=>g.re(0,0,0.48,0.86,0.14,g.W)
    +g.re(0,-0.04,0.34,0.58,0.04,g.D)
    +g.ln(-0.14,-0.68,0.14,-0.68,g.D)
    +g.ci(0,0.68,0.1,g.D)),
  // Bot: antenna, domed head, eyes, mouth grille, body, arms.
  robot: glyph(g=>g.pa(`M ${g.P(-0.56,0.16)} L ${g.P(-0.56,-0.2)} A ${num(0.56)} ${num(0.56)} 0 0 1 ${g.P(0.56,-0.2)} L ${g.P(0.56,0.16)} Z`,g.W)
    +g.dot(-0.22,-0.24,0.09)+g.dot(0.22,-0.24,0.09)
    +g.ln(-0.16,0.02,0.16,0.02,g.F)
    +g.ln(0,-0.7,0,-0.9,g.D)+g.dot(0,-0.94,0.08)
    +g.re(0,0.48,0.42,0.32,0.06,g.W)
    +g.ln(-0.42,0.34,-0.68,0.5,g.D)+g.ln(0.42,0.34,0.68,0.5,g.D)
    +g.ln(-0.16,0.5,0.16,0.5,g.F)),
  // Three stages joined by arrows.
  pipeline: glyph(g=>g.re(-0.62,0,0.24,0.3,0.06,g.W)+g.re(0,0,0.24,0.3,0.06,g.W)+g.re(0.62,0,0.24,0.3,0.06,g.W)
    +g.ln(-0.38,0,-0.34,0,g.D)+head(g,-0.24,0,1,0,0.16,g.D)
    +g.ln(0.24,0,0.28,0,g.D)+head(g,0.38,0,1,0,0.16,g.D)),
};
export function renderIcon(kind:NodeKind|undefined,cx:number,cy:number,r:number,stroke:string):string {
  const fn=kind&&ICONS[kind];
  return fn?`<g>${fn(cx,cy,r,stroke)}</g>`:'';
}
export function hasIcon(kind?:NodeKind):boolean { return !!(kind && kind!=='generic' && ICONS[kind]); }
