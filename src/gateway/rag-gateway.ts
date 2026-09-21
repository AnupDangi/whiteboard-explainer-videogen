import {log} from '../core/logger.js';
import type {BudgetLedger} from './budget-ledger.js';

interface RagGatewayRequest<T> {
  jobId:string;
  taskId:string;
  operation:'index'|'query';
  estimatedCostUsd:number;
  budgetLimitUsd:number;
  signal?:AbortSignal;
  execute:(signal:AbortSignal)=>Promise<T>;
}

/** Common budget/telemetry boundary for the Python RAG sidecar. The sidecar
 * does not expose provider token usage, so settlement is explicitly marked as
 * estimated rather than being confused with a zero-cost call. */
export class RagGateway {
  constructor(private readonly ledger:BudgetLedger){}

  async execute<T>(request:RagGatewayRequest<T>):Promise<T>{
    if(!Number.isFinite(request.estimatedCostUsd)||request.estimatedCostUsd<0)throw new Error('RAG estimate must be a non-negative finite amount');
    const reservationId=`rag:${request.taskId}:${request.operation}`;
    const started=Date.now();
    await this.ledger.reserve(request.jobId,reservationId,request.estimatedCostUsd,request.budgetLimitUsd);
    try{
      const value=await request.execute(request.signal??new AbortController().signal);
      await this.ledger.settle(request.jobId,reservationId,request.estimatedCostUsd);
      log('gateway.rag',{jobId:request.jobId,taskId:request.taskId,operation:request.operation,provider:'rag-anything',estimatedCostUsd:request.estimatedCostUsd,actualCostUsd:request.estimatedCostUsd,costEstimated:true,elapsedMs:Date.now()-started});
      return value;
    }catch(error){
      await this.ledger.release(request.jobId,reservationId);
      log('gateway.rag-failed',{jobId:request.jobId,taskId:request.taskId,operation:request.operation,elapsedMs:Date.now()-started,error},'warn');
      throw error;
    }
  }
}
