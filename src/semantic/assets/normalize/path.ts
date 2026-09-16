/** SVG path grammar. Relative commands are resolved to absolute here so the
 *  flattener and transform stage operate on one representation. Handles implicit
 *  repetition (extra coordinate pairs after a command), the `M`→`L` rule,
 *  shorthand reflection (`S`/`T`) and arc flags, which are single characters and
 *  must not be consumed as numbers. */
export type Segment =
 | {cmd:'M';x:number;y:number}
 | {cmd:'L';x:number;y:number}
 | {cmd:'C';x1:number;y1:number;x2:number;y2:number;x:number;y:number}
 | {cmd:'Q';x1:number;y1:number;x:number;y:number}
 | {cmd:'A';rx:number;ry:number;rotation:number;largeArc:number;sweep:number;x:number;y:number}
 | {cmd:'Z'};

const NUMBER=/^[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/;

class Scanner{
 private pos=0;
 constructor(private readonly source:string){}
 private skip(){while(this.pos<this.source.length&&/[\s,]/.test(this.source[this.pos]))this.pos++;}
 eof():boolean{this.skip();return this.pos>=this.source.length;}
 peek():string{this.skip();return this.source[this.pos]??'';}
 readCommand():string{this.skip();const c=this.source[this.pos]??'';if(!/[a-zA-Z]/.test(c))throw new Error(`Expected a path command at ${this.pos}`);this.pos++;return c;}
 readNumber():number{this.skip();const match=NUMBER.exec(this.source.slice(this.pos));if(!match||!match[0])throw new Error(`Invalid path number at ${this.pos}`);this.pos+=match[0].length;const value=Number(match[0]);if(!Number.isFinite(value))throw new Error(`Non-finite path number at ${this.pos}`);return value;}
 readFlag():0|1{this.skip();const c=this.source[this.pos];if(c!=='0'&&c!=='1')throw new Error(`Arc flags must be 0 or 1 (at ${this.pos})`);this.pos++;return c==='1'?1:0;}
}

export function parsePath(d:string):Segment[]{
 if(typeof d!=='string'||!d.trim())throw new Error('Path data is empty');
 const scanner=new Scanner(d),segments:Segment[]=[];
 let command='',cx=0,cy=0,sx=0,sy=0,lastCubic:number[]|undefined,lastQuad:number[]|undefined;
 while(!scanner.eof()){
  const next=scanner.peek();
  if(/[a-zA-Z]/.test(next))command=scanner.readCommand();
  else if(!command)throw new Error('Path data must start with a command');
  const relative=command===command.toLowerCase(),upper=command.toUpperCase();
  switch(upper){
   case 'M':{const x=scanner.readNumber(),y=scanner.readNumber();cx=relative?cx+x:x;cy=relative?cy+y:y;sx=cx;sy=cy;segments.push({cmd:'M',x:cx,y:cy});lastCubic=undefined;lastQuad=undefined;command=relative?'l':'L';break;}
   case 'L':{const x=scanner.readNumber(),y=scanner.readNumber();cx=relative?cx+x:x;cy=relative?cy+y:y;segments.push({cmd:'L',x:cx,y:cy});lastCubic=undefined;lastQuad=undefined;break;}
   case 'H':{const x=scanner.readNumber();cx=relative?cx+x:x;segments.push({cmd:'L',x:cx,y:cy});lastCubic=undefined;lastQuad=undefined;break;}
   case 'V':{const y=scanner.readNumber();cy=relative?cy+y:y;segments.push({cmd:'L',x:cx,y:cy});lastCubic=undefined;lastQuad=undefined;break;}
   case 'C':{const a=scanner.readNumber(),b=scanner.readNumber(),c=scanner.readNumber(),e=scanner.readNumber(),f=scanner.readNumber(),g=scanner.readNumber();const x1=relative?cx+a:a,y1=relative?cy+b:b,x2=relative?cx+c:c,y2=relative?cy+e:e,x=relative?cx+f:f,y=relative?cy+g:g;segments.push({cmd:'C',x1,y1,x2,y2,x,y});lastCubic=[x2,y2];lastQuad=undefined;cx=x;cy=y;break;}
   case 'S':{const c=scanner.readNumber(),e=scanner.readNumber(),f=scanner.readNumber(),g=scanner.readNumber();const [x1,y1]=lastCubic?[2*cx-lastCubic[0],2*cy-lastCubic[1]]:[cx,cy];const x2=relative?cx+c:c,y2=relative?cy+e:e,x=relative?cx+f:f,y=relative?cy+g:g;segments.push({cmd:'C',x1,y1,x2,y2,x,y});lastCubic=[x2,y2];lastQuad=undefined;cx=x;cy=y;break;}
   case 'Q':{const a=scanner.readNumber(),b=scanner.readNumber(),f=scanner.readNumber(),g=scanner.readNumber();const x1=relative?cx+a:a,y1=relative?cy+b:b,x=relative?cx+f:f,y=relative?cy+g:g;segments.push({cmd:'Q',x1,y1,x,y});lastQuad=[x1,y1];lastCubic=undefined;cx=x;cy=y;break;}
   case 'T':{const f=scanner.readNumber(),g=scanner.readNumber();const [x1,y1]=lastQuad?[2*cx-lastQuad[0],2*cy-lastQuad[1]]:[cx,cy];const x=relative?cx+f:f,y=relative?cy+g:g;segments.push({cmd:'Q',x1,y1,x,y});lastQuad=[x1,y1];lastCubic=undefined;cx=x;cy=y;break;}
   case 'A':{const rx=scanner.readNumber(),ry=scanner.readNumber(),rotation=scanner.readNumber(),largeArc=scanner.readFlag(),sweep=scanner.readFlag(),f=scanner.readNumber(),g=scanner.readNumber();const x=relative?cx+f:f,y=relative?cy+g:g;segments.push({cmd:'A',rx,ry,rotation,largeArc,sweep,x,y});lastCubic=undefined;lastQuad=undefined;cx=x;cy=y;break;}
   case 'Z':{segments.push({cmd:'Z'});cx=sx;cy=sy;lastCubic=undefined;lastQuad=undefined;break;}
   default:throw new Error(`Unsupported path command: ${command}`);
  }
 }
 return segments;
}
