import type {Point} from '../../types.js';
import type {Segment} from './path.js';

export interface SubPath{points:Point[];closed:boolean}

const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
const cubic=(p0:number,p1:number,p2:number,p3:number,t:number)=>{const u=1-t;return u*u*u*p0+3*u*u*t*p1+3*u*t*t*p2+t*t*t*p3;};
const quad=(p0:number,p1:number,p2:number,t:number)=>{const u=1-t;return u*u*p0+2*u*t*p1+t*t*p2;};

/** Endpoint-parameterised arc (SVG `A`) to polyline points. Implements the
 *  standard conversion from endpoint to centre parameterisation, including the
 *  out-of-range radius correction, so an arc never becomes a straight guess. */
function arcPoints(from:Point,seg:Extract<Segment,{cmd:'A'}>,steps:number):Point[]{
 const {rx:rxIn,ry:ryIn,rotation,largeArc,sweep,x,y}=seg;
 /** Per the SVG spec an arc whose endpoints coincide is omitted; without this
    * the centre-parameterisation divides by zero and yields NaN points. */
  if(Math.abs(from.x-x)<1e-9&&Math.abs(from.y-y)<1e-9)return [];
 if(rxIn===0||ryIn===0)return [{x,y}];
 let rx=Math.abs(rxIn),ry=Math.abs(ryIn);
 const phi=rotation*Math.PI/180,cos=Math.cos(phi),sin=Math.sin(phi);
 const dx=(from.x-x)/2,dy=(from.y-y)/2;
 const x1p=cos*dx+sin*dy,y1p=-sin*dx+cos*dy;
 const lambda=(x1p*x1p)/(rx*rx)+(y1p*y1p)/(ry*ry);
 if(lambda>1){const scale=Math.sqrt(lambda);rx*=scale;ry*=scale;}
 const num=rx*rx*ry*ry-rx*rx*y1p*y1p-ry*ry*x1p*x1p;
 const den=rx*rx*y1p*y1p+ry*ry*x1p*x1p;
 const co=(largeArc!==sweep?1:-1)*Math.sqrt(Math.max(0,num/den));
 const cxp=co*(rx*y1p/ry),cyp=co*(-ry*x1p/rx);
 const cx=cos*cxp-sin*cyp+(from.x+x)/2,cy=sin*cxp+cos*cyp+(from.y+y)/2;
 const angle=(ux:number,uy:number,vx:number,vy:number)=>Math.atan2(ux*vy-uy*vx,ux*vx+uy*vy);
 const ux=(x1p-cxp)/rx,uy=(y1p-cyp)/ry,vx=(-x1p-cxp)/rx,vy=(-y1p-cyp)/ry;
 const start=angle(1,0,ux,uy);
 let delta=angle(ux,uy,vx,vy);
 if(!sweep&&delta>0)delta-=2*Math.PI;
 if(sweep&&delta<0)delta+=2*Math.PI;
 const points:Point[]=[];
 for(let i=1;i<=steps;i++){
  const theta=start+delta*(i/steps);
  const px=rx*Math.cos(theta),py=ry*Math.sin(theta);
  points.push({x:cos*px-sin*py+cx,y:sin*px+cos*py+cy});
 }
 return points;
}

/** Flatten segments into polylines. Curves are sampled at a fixed count so the
 *  output is deterministic and identical on every run. */
export function flattenSegments(segments:Segment[],curveSegments=8):SubPath[]{
 if(!Number.isInteger(curveSegments)||curveSegments<2||curveSegments>64)throw new Error('curveSegments must be 2-64');
 const subpaths:SubPath[]=[];
 let current:SubPath|undefined,last:Point={x:0,y:0};
 for(const segment of segments){
  switch(segment.cmd){
   case 'M':{
    current={points:[{x:segment.x,y:segment.y}],closed:false};
    subpaths.push(current);last={x:segment.x,y:segment.y};
    break;}
   case 'L':{
    if(!current)throw new Error('Subpath must start with M');
    current.points.push({x:segment.x,y:segment.y});last={x:segment.x,y:segment.y};
    break;}
   case 'C':{
    if(!current)throw new Error('Subpath must start with M');
    const from={...last};
    for(let i=1;i<=curveSegments;i++){
     const t=i/curveSegments;
     current.points.push({x:cubic(from.x,segment.x1,segment.x2,segment.x,t),y:cubic(from.y,segment.y1,segment.y2,segment.y,t)});
    }
    last={x:segment.x,y:segment.y};
    break;}
   case 'Q':{
    if(!current)throw new Error('Subpath must start with M');
    const from={...last};
    for(let i=1;i<=curveSegments;i++){
     const t=i/curveSegments;
     current.points.push({x:quad(from.x,segment.x1,segment.x,t),y:quad(from.y,segment.y1,segment.y,t)});
    }
    last={x:segment.x,y:segment.y};
    break;}
   case 'A':{
    if(!current)throw new Error('Subpath must start with M');
    const points=arcPoints(last,segment,curveSegments);
    current.points.push(...points);last={x:segment.x,y:segment.y};
    break;}
   case 'Z':{
    if(!current)throw new Error('Subpath must start with M');
    current.closed=true;
    last={...current.points[0]};
    break;}
  }
 }
 return subpaths.filter(sub=>sub.points.length>=2);
}

/** Rectangle/circle/ellipse/line/polyline/polygon as a polyline. */
const NUMBER_OR_ZERO=/^-?\d*\.?\d+(?:[eE][-+]?\d+)?/;
export function primitiveToSubPath(tag:string,attrs:Record<string,string>,curveSegments=24):SubPath|undefined{
 const num=(name:string,fallback=0)=>{const raw=attrs[name];if(raw===undefined)return fallback;const value=Number(NUMBER_OR_ZERO.exec(raw)?.[0]??NaN);if(!Number.isFinite(value))throw new Error(`Invalid ${name} on <${tag}>`);return value;};
 switch(tag){
  case 'rect':{const x=num('x'),y=num('y'),w=num('width'),h=num('height');if(w<=0||h<=0)throw new Error('rect needs positive width and height');return {points:[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}],closed:true};}
  case 'circle':{const cx=num('cx'),cy=num('cy'),r=num('r');if(r<=0)throw new Error('circle needs a positive radius');return {points:ellipsePoints(cx,cy,r,r,curveSegments),closed:true};}
  case 'ellipse':{const cx=num('cx'),cy=num('cy'),rx=num('rx'),ry=num('ry');if(rx<=0||ry<=0)throw new Error('ellipse needs positive radii');return {points:ellipsePoints(cx,cy,rx,ry,curveSegments),closed:true};}
  case 'line':{return {points:[{x:num('x1'),y:num('y1')},{x:num('x2'),y:num('y2')}],closed:false};}
  case 'polyline':case 'polygon':{
   const raw=attrs.points;if(!raw)throw new Error(`${tag} needs points`);
   const numbers=[...raw.matchAll(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g)].map(m=>Number(m[0]));
   if(numbers.length<4||numbers.length%2)throw new Error(`${tag} points must be x,y pairs`);
   const points:Point[]=[];
   for(let i=0;i<numbers.length;i+=2)points.push({x:numbers[i],y:numbers[i+1]});
   return {points,closed:tag==='polygon'};
  }
  default:return undefined;
 }
}
function ellipsePoints(cx:number,cy:number,rx:number,ry:number,steps:number):Point[]{
 const points:Point[]=[];
 for(let i=0;i<steps;i++){const theta=2*Math.PI*(i/steps);points.push({x:cx+rx*Math.cos(theta),y:cy+ry*Math.sin(theta)});}
 return points;
}
