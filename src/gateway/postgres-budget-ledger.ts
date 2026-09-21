import type {SqlClient} from '../runtime/postgres-repository.js';
import type {BudgetLedger,BudgetReservation,BudgetState} from './budget-ledger.js';

type UsageRow={id:string;job_id:string;reserved_usd:string|number;actual_usd:string|number|null;status:'reserved'|'settled'|'refunded'};
const reservation=(row:UsageRow):BudgetReservation=>({jobId:String(row.job_id),reservationId:String(row.id),estimatedUsd:Number(row.reserved_usd),status:row.status==='refunded'?'released':row.status,actualUsd:row.actual_usd==null?undefined:Number(row.actual_usd)});

/** Transactional PostgreSQL ledger used by API and disposable workers. Locking
 * the job row serializes concurrent reservations before any provider I/O. */
export class PostgresBudgetLedger implements BudgetLedger {
  constructor(private readonly sql:SqlClient,private readonly provider='gateway'){}

  async reserve(jobId:string,reservationId:string,estimatedUsd:number,limitUsd:number):Promise<BudgetReservation>{
    if(!Number.isFinite(estimatedUsd)||estimatedUsd<0)throw new Error('Budget estimate must be a non-negative finite amount');
    const result=await this.sql.query<UsageRow>(`
      WITH locked_job AS (
        SELECT id,LEAST(budget_limit_usd,$4::numeric) AS ceiling FROM jobs WHERE id=$1 FOR UPDATE
      ), existing AS (
        SELECT * FROM usage_reservations WHERE id=$2
      ), totals AS (
        SELECT COALESCE(sum(CASE WHEN status='reserved' THEN reserved_usd ELSE actual_usd END),0) AS committed
        FROM usage_reservations WHERE job_id=$1 AND status IN ('reserved','settled')
      ), inserted AS (
        INSERT INTO usage_reservations(id,job_id,provider,reserved_usd,status,created_at)
        SELECT $2,$1,$5,$3,'reserved',now() FROM locked_job,totals
        WHERE NOT EXISTS (SELECT 1 FROM existing) AND totals.committed+$3 <= locked_job.ceiling
        ON CONFLICT DO NOTHING RETURNING *
      ) SELECT * FROM inserted UNION ALL SELECT * FROM existing LIMIT 1
    `,[jobId,reservationId,estimatedUsd,limitUsd,this.provider]);
    if(!result.rows[0])throw new Error('Paid API budget would be exceeded');
    const found=reservation(result.rows[0]);
    if(found.jobId!==jobId||Math.abs(found.estimatedUsd-estimatedUsd)>1e-9)throw new Error('Budget reservation id reused with different inputs');
    return found;
  }

  async settle(jobId:string,reservationId:string,actualUsd:number):Promise<BudgetReservation>{
    if(!Number.isFinite(actualUsd)||actualUsd<0)throw new Error('Actual cost must be a non-negative finite amount');
    const result=await this.sql.query<UsageRow>(`
      WITH locked_job AS (
        SELECT id,budget_limit_usd AS ceiling FROM jobs WHERE id=$1 FOR UPDATE
      ), current AS (
        SELECT * FROM usage_reservations WHERE id=$2 AND job_id=$1
      ), other_totals AS (
        SELECT COALESCE(sum(CASE WHEN status='reserved' THEN reserved_usd ELSE actual_usd END),0) AS committed
        FROM usage_reservations WHERE job_id=$1 AND id<>$2 AND status IN ('reserved','settled')
      ), updated AS (
        UPDATE usage_reservations SET status='settled',actual_usd=$3,settled_at=now()
        FROM locked_job,other_totals
        WHERE usage_reservations.id=$2 AND usage_reservations.job_id=$1
          AND usage_reservations.status='reserved'
          AND other_totals.committed+$3 <= locked_job.ceiling
        RETURNING usage_reservations.*
      ) SELECT * FROM updated UNION ALL SELECT * FROM current LIMIT 1
    `,[jobId,reservationId,actualUsd]);
    if(!result.rows[0])throw new Error(`Unknown budget reservation ${reservationId}`);
    const found=reservation(result.rows[0]);
    if(found.status==='reserved')throw new Error('Actual provider cost would exceed the job budget');
    if(found.status!=='settled'||Math.abs((found.actualUsd??0)-actualUsd)>1e-9)throw new Error(`Reservation ${reservationId} is already finalized differently`);
    return found;
  }

  async release(jobId:string,reservationId:string):Promise<BudgetReservation>{
    const result=await this.sql.query<UsageRow>(`
      WITH updated AS (
        UPDATE usage_reservations SET status='refunded',actual_usd=0,settled_at=now()
        WHERE id=$2 AND job_id=$1 AND status='reserved' RETURNING *
      ) SELECT * FROM updated UNION ALL SELECT * FROM usage_reservations WHERE id=$2 AND job_id=$1 LIMIT 1
    `,[jobId,reservationId]);
    if(!result.rows[0])throw new Error(`Unknown budget reservation ${reservationId}`);
    return reservation(result.rows[0]);
  }

  async state(jobId:string,limitUsd:number):Promise<BudgetState>{
    const result=await this.sql.query<{planned:string|number;reserved:string|number;spent:string|number;calls:string|number}>(`
      SELECT COALESCE(sum(reserved_usd),0) AS planned,
        COALESCE(sum(reserved_usd) FILTER (WHERE status='reserved'),0) AS reserved,
        COALESCE(sum(actual_usd) FILTER (WHERE status='settled'),0) AS spent,
        count(*) AS calls
      FROM usage_reservations WHERE job_id=$1
    `,[jobId]);
    const row=result.rows[0]??{planned:0,reserved:0,spent:0,calls:0};const reservedUsd=Number(row.reserved),spentUsd=Number(row.spent);
    return {jobId,limitUsd,plannedUsd:Number(row.planned),reservedUsd,spentUsd,availableUsd:Math.max(0,limitUsd-reservedUsd-spentUsd),calls:Number(row.calls)};
  }
}
