import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export interface SkillContract {name:string;content:string;hash:string;invariants:string[]}

const cache=new Map<string,SkillContract>();

/** Loads a local skill's compiled contract: its exact content, a content hash
 *  recorded in stage envelopes, and its Hard invariants as prompt instructions.
 *  Skill text is data, never executable runtime control. */
export function skillContract(name:string):SkillContract{
 const cached=cache.get(name);
 if(cached)return cached;
 const here=dirname(fileURLToPath(import.meta.url));
 const candidates=[
  join(here,'..','..','..','skills',name,'SKILL.md'),
  join(here,'..','..','skills',name,'SKILL.md'),
  join(here,'..','skills',name,'SKILL.md')
 ];
 const path=candidates.find(candidate=>{try{readFileSync(candidate);return true;}catch{return false;}});
 if(!path)throw new Error(`Skill ${name} not found in ${candidates.join(', ')}`);
 const content=readFileSync(path,'utf8');
 const invariants=extractInvariants(content);
 const contract:SkillContract={name,content,hash:createHash('sha256').update(content).digest('hex'),invariants};
 cache.set(name,contract);
 return contract;
}

function extractInvariants(content:string):string[]{
 const start=content.indexOf('# Hard invariants');
 if(start<0)return [];
 const section=content.slice(start+('# Hard invariants'.length));
 const end=section.indexOf('\n# ');
 const body=(end>=0?section.slice(0,end):section).trim();
 return body.split('\n').map(line=>line.trim().replace(/^-\s*/,'')).filter(Boolean).slice(0,10);
}

/** Instruction suffix: the skill's hard invariants as bounded, non-executable prose. */
export function skillInstruction(name:string):string{
 const contract=skillContract(name);
 if(!contract.invariants.length)return '';
 return `Hard invariants from the ${name} skill: ${contract.invariants.join('; ')}.`;
}

/** Loads any skill document by its path relative to `skills/` (for example
 *  `teaching-architect/references/knowledge-compiler.md`). Used after overflow
 *  documents move under the owning skill's references/. */
export function skillDoc(relativePath:string):SkillContract{
 const cached=cache.get(relativePath);
 if(cached)return cached;
 const here=dirname(fileURLToPath(import.meta.url));
 const candidates=[
  join(here,'..','..','..','skills',relativePath),
  join(here,'..','..','skills',relativePath),
  join(here,'..','skills',relativePath)
 ];
 const path=candidates.find(candidate=>{try{readFileSync(candidate);return true;}catch{return false;}});
 if(!path)throw new Error(`Skill document ${relativePath} not found in ${candidates.join(', ')}`);
 const content=readFileSync(path,'utf8');
 const name=(relativePath.split('/').pop()??relativePath).replace(/\.md$/,'');
 const contract:SkillContract={name,content,hash:createHash('sha256').update(content).digest('hex'),invariants:extractInvariants(content)};
 cache.set(relativePath,contract);
 return contract;
}

export function skillDocInstruction(relativePath:string):string{
 const contract=skillDoc(relativePath);
 if(!contract.invariants.length)return '';
 return `Hard invariants from the ${contract.name} skill: ${contract.invariants.join('; ')}.`;
}
