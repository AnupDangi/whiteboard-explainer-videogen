import {createRequire} from 'node:module';
import {readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PostgresRuntimeRepository,type SqlClient} from './postgres-repository.js';
import type {RuntimeRepository} from './repository.js';
import {PostgresBudgetLedger} from '../gateway/postgres-budget-ledger.js';
import type {BudgetLedger} from '../gateway/budget-ledger.js';
import {applyMigrations} from './migrations.js';

interface ConfiguredRuntime {
  repository:RuntimeRepository;
  budgetLedger:BudgetLedger;
  close:()=>Promise<void>;
}

/**
 * Create the production repository only when DATABASE_URL is configured. `pg` is
 * intentionally loaded at runtime so renderer/unit-only installs remain
 * dependency-light; a configured durable deployment gets a clear install error
 * instead of silently falling back to an in-memory queue.
 */
export async function createConfiguredPostgresRuntime(env:NodeJS.ProcessEnv=process.env):Promise<ConfiguredRuntime|undefined>{
  const connectionString=env.DATABASE_URL?.trim();
  if(!connectionString)return undefined;
  const require=createRequire(import.meta.url);
  let pg:{Pool:new(options:{connectionString:string;max?:number})=>SqlClient&{end:()=>Promise<void>}};
  try{pg=require('pg') as typeof pg;}catch{throw new Error('DATABASE_URL is configured but the optional "pg" package is not installed; run npm install pg');}
  const pool=new pg.Pool({connectionString,max:Math.max(1,Math.min(20,Number(env.PG_POOL_MAX||10)))}) as SqlClient&{end:()=>Promise<void>};
  try{
    const migrationCandidates=[
      env.MIGRATIONS_DIR?.trim()?resolve(env.MIGRATIONS_DIR.trim()):undefined,
      resolve(process.cwd(),'migrations'),
      fileURLToPath(new URL('../../../migrations',import.meta.url)),
    ].filter((candidate):candidate is string=>Boolean(candidate));
    let migrationDir:string|undefined;
    let lastReadError:unknown;
    for(const candidate of migrationCandidates){try{const names=await readdir(candidate);if(names.some(name=>/^\d+_.+\.sql$/i.test(name))){migrationDir=candidate;break;}}catch(error){lastReadError=error;}}
    if(!migrationDir)throw lastReadError instanceof Error?lastReadError:new Error('Migration directory not found');
    await applyMigrations(pool,migrationDir);
  }catch(error){await pool.end().catch(()=>undefined);throw new Error(`PostgreSQL migration failed: ${error instanceof Error?error.message:String(error)}`);}
  return {repository:new PostgresRuntimeRepository(pool),budgetLedger:new PostgresBudgetLedger(pool),close:()=>pool.end()};
}
