import {createConfiguredPostgresRuntime} from '../src/runtime/postgres-bootstrap.js';
import {DurableJobService} from '../src/runtime/job-service.js';
import {SYSTEM_VERSIONS} from '../src/core/versions.js';

/**
 * Small release-evidence drill for the production queue. It deliberately
 * closes and recreates the pool between claim and verification: a successful
 * run proves migration, lease persistence, task completion, and restart
 * visibility rather than only exercising an in-process repository.
 *
 * With no DATABASE_URL this is an explicit skip, never a fake pass. The CI or
 * deployment environment should run `npm run test:postgres` with a disposable
 * PostgreSQL database to turn the gate green.
 */
const started=Date.now();
if(!process.env.DATABASE_URL){
  console.log(JSON.stringify({status:'skipped',reason:'DATABASE_URL is not configured',elapsedMs:Date.now()-started}));
  process.exit(0);
}
const first=await createConfiguredPostgresRuntime();
if(!first)throw new Error('PostgreSQL runtime was not configured');
const request={version:2,instruction:'PostgreSQL restart smoke',sources:[{kind:'text' as const,title:'Queue smoke',text:'A durable queue survives a worker restart.'}],durationMinutes:1 as const,language:'en',groundingPolicy:'source-only' as const,learnerContext:{level:'beginner' as const},stylePreferences:{captionMode:'off' as const},generationBudget:{maxCostUsd:.5,maxPaidRepairs:0}};
const service=new DurableJobService(first.repository);
const idempotency=`postgres-smoke-${Date.now()}`;
const submitted=await service.submit(request,idempotency);
const ingest=submitted.tasks.find(task=>task.kind==='source.ingest');
if(!ingest)throw new Error('Smoke job did not enqueue source.ingest');
const claimed=await first.repository.claimTask({workerId:'postgres-smoke',pools:['ingest'],leaseMs:10_000});
if(!claimed||claimed.id!==ingest.id)throw new Error('Smoke worker could not claim source.ingest');
await first.repository.completeTask({taskId:claimed.id,workerId:'postgres-smoke'});
await first.close();

const second=await createConfiguredPostgresRuntime();
if(!second)throw new Error('PostgreSQL runtime disappeared after restart');
try{
  const job=await second.repository.getJob(submitted.id);
  const task=await second.repository.getTask(ingest.id);
  if(!job||!task||task.status!=='succeeded')throw new Error('Restart verification did not observe the completed task');
  console.log(JSON.stringify({status:'passed',jobId:submitted.id,schemaVersion:SYSTEM_VERSIONS.schema,jobStatus:job.status,taskStatus:task.status,elapsedMs:Date.now()-started}));
}finally{await second.close();}
