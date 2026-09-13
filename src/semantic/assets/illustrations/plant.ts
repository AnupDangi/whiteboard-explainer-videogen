import type {AssetDefinition} from '../types.js';
import {point as p,curve,part} from '../geometry.js';
const leaf=(id:string,start:[number,number],tip:[number,number],bend:number,order:number)=>{
 const [x,y]=start,[tx,ty]=tip;
 return part(id,[...curve(p(x,y),p(x+bend,y-45),p(tx,ty+15),p(tx,ty)),...curve(p(tx,ty),p(tx-bend*.1,ty+60),p(x+bend*.55,y+22),p(x,y)).slice(1)],order,'green','green','leaf');
};
export const plant:AssetDefinition={id:'biology.plant.sapling.v2',type:'illustration',semanticTypes:['entity'],aliases:['plant','sapling'],tags:['biology','photosynthesis','roots','leaf','food'],archetypes:['structural_diagram','convergence'],viewBox:[0,0,300,400],styleFamily:'chalk-ink-v2',source:'Original project geometry',license:'project-original',
 anchorAliases:{'leaf.underside':'leaf.right','leaf.surface':'leaf.top','leaves':'leaf.top','root.bottom':'roots','root':'roots'},
 anchors:{roots:p(150,338),stem:p(151,235),'leaf.top':p(181,100),'leaf.left':p(65,155),'leaf.right':p(242,206),'leaf.side':p(242,206),canopy:p(156,136),input:p(30,180),output:p(270,180),center:p(150,200)},
 parts:[
 part('stem',curve(p(150,318),p(142,250),p(163,160),p(151,72)),0,'green'),
 leaf('leaf_top',[154,156],[196,48],60,1),leaf('leaf_left',[152,207],[40,123],-96,2),leaf('leaf_right',[151,264],[268,164],100,3),leaf('leaf_lower',[150,294],[71,237],-64,4),
 part('vein_top',curve(p(154,156),p(166,126),p(180,83),p(196,48)),5,'green'),
 part('vein_left',curve(p(152,207),p(116,190),p(74,147),p(40,123)),6,'green'),
 part('vein_right',curve(p(151,264),p(199,227),p(226,201),p(268,164)),7,'green'),
 part('soil',[p(27,317),p(82,315),p(136,318),p(190,315),p(270,317)],8,'earth'),
 ...[[[150,316],[142,341],[118,351],[102,383]],[[150,316],[164,345],[179,355],[190,381]],[[150,322],[149,347],[153,368],[151,394]],[[133,345],[112,350],[86,347],[70,364]],[[168,348],[190,346],[215,359],[235,367]],[[118,360],[104,360],[91,371],[87,381]]].map((v,i)=>part(`root_${i}`,curve(...v.map(([x,y])=>p(x,y)) as [ReturnType<typeof p>,ReturnType<typeof p>,ReturnType<typeof p>,ReturnType<typeof p>]),9+i,'earth')),
 ],states:{neutral:{partIds:[]},highlighted:{partIds:['leaf_top','leaf_left','leaf_right']},activated:{partIds:['leaf_top','leaf_left','leaf_right','leaf_lower']}}};
