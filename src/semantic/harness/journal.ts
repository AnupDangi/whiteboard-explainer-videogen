import {appendFile,mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import type {HarnessStage,StageJournalEntry} from './contracts.js';

export interface StageJournal {append(entry:StageJournalEntry):Promise<void>;persistInput?(stage:HarnessStage,attempt:0|1,inputHash:string,input:unknown):Promise<void>}
export class FileStageJournal implements StageJournal{
 private sequence=0;
 constructor(private readonly path:string){}
 async append(entry:StageJournalEntry){await mkdir(dirname(this.path),{recursive:true});await appendFile(this.path,JSON.stringify(entry)+'\n');}
 async persistInput(stage:HarnessStage,attempt:0|1,inputHash:string,input:unknown){const sequence=++this.sequence,dir=dirname(this.path);await mkdir(dir,{recursive:true});await writeFile(`${dir}/stage-${String(sequence).padStart(3,'0')}-${stage}-attempt-${attempt}-${inputHash.slice(0,12)}-input.json`,JSON.stringify(input,null,2));}
}
export class MemoryStageJournal implements StageJournal{
 readonly entries:StageJournalEntry[]=[];
 readonly inputs:{stage:HarnessStage;attempt:0|1;inputHash:string;input:unknown}[]=[];
 async append(entry:StageJournalEntry){this.entries.push(structuredClone(entry));}
 async persistInput(stage:HarnessStage,attempt:0|1,inputHash:string,input:unknown){this.inputs.push({stage,attempt,inputHash,input:structuredClone(input)});}
}
