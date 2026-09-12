import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ASSETS} from '../src/v2/assets/registry.js';
import {renderIllustration} from '../src/v2/renderer/illustrations.js';
import {escape} from '../src/v2/renderer/style.js';
import type {CompiledObject} from '../src/v2/types.js';
const out=process.argv[2]??'output/v2-assets';await mkdir(out,{recursive:true});const sharp=(await import('sharp')).default,tiles=[];
for(const [i,a] of ASSETS.entries()){
 const o:CompiledObject={id:'asset',label:a.aliases[0],role:'support',assetRef:a.id,children:[],state:'neutral',allowedStates:['neutral'],importance:'primary',collisionPolicy:'forbid',x:70,y:22,w:160,h:160,fontSize:16,lines:[],zIndex:1,anchors:{}};
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="235" viewBox="0 0 300 235"><rect width="300" height="235" fill="#faf9f3"/>${renderIllustration(o,1,0).svg}<text x="150" y="205" font-family="Arial" font-size="16" text-anchor="middle" fill="#233832">${escape(a.aliases[0])}</text><text x="150" y="223" font-family="Arial" font-size="10" text-anchor="middle" fill="#65776b">${escape(a.id)}</text></svg>`;
 await writeFile(join(out,a.id+'.svg'),svg);tiles.push({input:await sharp(Buffer.from(svg)).png().toBuffer(),left:i%5*300,top:Math.floor(i/5)*235});
}
await sharp({create:{width:1500,height:Math.ceil(ASSETS.length/5)*235,channels:4,background:'#faf9f3'}}).composite(tiles).png().toFile(join(out,'contact-sheet.png'));
await writeFile(join(out,'manifest.json'),JSON.stringify(ASSETS.map(a=>({id:a.id,parts:a.parts.length,anchors:Object.keys(a.anchors),styleFamily:a.styleFamily,license:a.license})),null,2));console.log(JSON.stringify({out,assets:ASSETS.length}));
