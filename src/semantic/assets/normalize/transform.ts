import type {Point} from '../../types.js';
/** 2x3 affine matrix `[a b c d e f]` in SVG order. */
export type Matrix=readonly [number,number,number,number,number,number];
export const IDENTITY:Matrix=[1,0,0,1,0,0];

export function multiply(m:Matrix,n:Matrix):Matrix{
 return [
  m[0]*n[0]+m[2]*n[1], m[1]*n[0]+m[3]*n[1],
  m[0]*n[2]+m[2]*n[3], m[1]*n[2]+m[3]*n[3],
  m[0]*n[4]+m[2]*n[5]+m[4], m[1]*n[4]+m[3]*n[5]+m[5],
 ];
}
export function applyMatrix(m:Matrix,p:Point):Point{return {x:m[0]*p.x+m[2]*p.y+m[4],y:m[1]*p.x+m[3]*p.y+m[5]};}

const NUMBER=/(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
const NUMBER_AT=/^(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/;
const rotate=(deg:number):Matrix=>{const r=deg*Math.PI/180,c=Math.cos(r),s=Math.sin(r);return [c,s,-s,c,0,0];};

/** Parse an SVG `transform` list into one matrix. Supports the six standard
 *  functions; an unknown function is rejected rather than ignored, so a
 *  transform can never be silently dropped and change the artwork. */
export function parseTransform(value:string):Matrix{
 if(!value||!value.trim())return IDENTITY;
 let matrix:Matrix=IDENTITY,index=0;
 while(index<value.length){
  const rest=value.slice(index);
  const name=/^\s*([a-zA-Z]+)\s*\(/.exec(rest);
  if(!name)throw new Error(`Invalid transform at ${index}: ${rest.slice(0,24)}`);
  const open=index+name[0].length;
  const close=value.indexOf(')',open);
  if(close<0)throw new Error('Unterminated transform function');
  const args=value.slice(open,close);
  const numbers=[...args.matchAll(NUMBER)].map(m=>Number(m[1]));
  if(args.replace(NUMBER,'').replace(/[\s,]/g,''))throw new Error(`Non-numeric transform argument: ${args}`);
  switch(name[1]){
   case 'translate':{const [tx=0,ty=0]=numbers;if(numbers.length<1||numbers.length>2)throw new Error('translate takes 1 or 2 arguments');matrix=multiply(matrix,[1,0,0,1,tx,ty]);break;}
   case 'scale':{const [sx,sy=sx]=numbers;if(numbers.length<1||numbers.length>2)throw new Error('scale takes 1 or 2 arguments');matrix=multiply(matrix,[sx,0,0,sy,0,0]);break;}
   case 'rotate':{
    if(numbers.length!==1&&numbers.length!==3)throw new Error('rotate takes 1 or 3 arguments');
    const [deg,cx,cy]=numbers.length===3?numbers:[numbers[0],0,0];
    if(numbers.length===3)matrix=multiply(matrix,[1,0,0,1,cx,cy]);
    matrix=multiply(matrix,rotate(deg));
    if(numbers.length===3)matrix=multiply(matrix,[1,0,0,1,-cx,-cy]);
    break;}
   case 'skewX':{const [deg]=numbers;if(numbers.length!==1)throw new Error('skewX takes 1 argument');matrix=multiply(matrix,[1,0,Math.tan(deg*Math.PI/180),1,0,0]);break;}
   case 'skewY':{const [deg]=numbers;if(numbers.length!==1)throw new Error('skewY takes 1 argument');matrix=multiply(matrix,[1,Math.tan(deg*Math.PI/180),0,1,0,0]);break;}
   case 'matrix':{if(numbers.length!==6)throw new Error('matrix takes 6 arguments');matrix=multiply(matrix,numbers as unknown as Matrix);break;}
   default:throw new Error(`Unsupported transform function: ${name[1]}`);
  }
  index=close+1;
 }
 return matrix;
}

export {NUMBER_AT};
