import {readdir,readFile} from 'node:fs/promises';
import {basename,join} from 'node:path';
import type {SqlClient} from './postgres-repository.js';

/** Apply numbered SQL migrations exactly once. The migration files remain plain
 * SQL so operators can inspect or apply them independently, while the durable
 * server keeps a small ledger that makes restarts and future schema additions
 * safe. Each migration owns its transaction (the initial migration includes
 * BEGIN/COMMIT); the ledger row is written only after the SQL succeeds. */
export async function applyMigrations(sql:SqlClient,directory:string):Promise<string[]> {
  await sql.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const files=(await readdir(directory)).filter(name=>/^\d+_.+\.sql$/i.test(name)).sort((a,b)=>a.localeCompare(b));
  const applied:string[]=[];
  for(const file of files){
    const version=basename(file,'.sql');
    const existing=await sql.query(`SELECT 1 FROM schema_migrations WHERE version=$1`,[version]);
    if(existing.rows.length)continue;
    await sql.query(await readFile(join(directory,file),'utf8'));
    await sql.query(`INSERT INTO schema_migrations(version) VALUES ($1) ON CONFLICT DO NOTHING`,[version]);
    applied.push(version);
  }
  if(!files.length)throw new Error(`No SQL migrations found in ${directory}`);
  return applied;
}
