export interface BudgetState {
  jobId:string;
  limitUsd:number;
  plannedUsd:number;
  reservedUsd:number;
  spentUsd:number;
  availableUsd:number;
  /** Number of distinct gateway reservations, including released/settled calls. */
  calls:number;
}

export interface BudgetReservation {
  jobId:string;
  reservationId:string;
  estimatedUsd:number;
  status:'reserved'|'settled'|'released';
  actualUsd?:number;
}

export interface BudgetLedger {
  reserve(jobId:string,reservationId:string,estimatedUsd:number,limitUsd:number):Promise<BudgetReservation>;
  settle(jobId:string,reservationId:string,actualUsd:number):Promise<BudgetReservation>;
  release(jobId:string,reservationId:string):Promise<BudgetReservation>;
  state(jobId:string,limitUsd:number):Promise<BudgetState>;
}

interface JobLedger {
  plannedUsd:number;
  reservations:Map<string,BudgetReservation>;
}

/** Deterministic development/test ledger. The Postgres implementation uses the
 * same contract and transactionally locks the job usage row before reserving. */
export class InMemoryBudgetLedger implements BudgetLedger {
  private readonly jobs=new Map<string,JobLedger>();

  private job(jobId:string):JobLedger {
    let ledger=this.jobs.get(jobId);
    if(!ledger){ledger={plannedUsd:0,reservations:new Map()};this.jobs.set(jobId,ledger);}
    return ledger;
  }

  async reserve(jobId:string,reservationId:string,estimatedUsd:number,limitUsd:number):Promise<BudgetReservation>{
    if(!Number.isFinite(estimatedUsd)||estimatedUsd<0)throw new Error('Budget estimate must be a non-negative finite amount');
    if(!Number.isFinite(limitUsd)||limitUsd<=0)throw new Error('Budget limit must be a positive finite amount');
    const ledger=this.job(jobId);
    const existing=ledger.reservations.get(reservationId);
    if(existing)return {...existing};
    const current=this.totals(ledger);
    if(current.reservedUsd+current.spentUsd+estimatedUsd>limitUsd+1e-9)throw new Error('Paid API budget would be exceeded');
    const reservation:BudgetReservation={jobId,reservationId,estimatedUsd,status:'reserved'};
    ledger.reservations.set(reservationId,reservation);
    ledger.plannedUsd+=estimatedUsd;
    return {...reservation};
  }

  async settle(jobId:string,reservationId:string,actualUsd:number):Promise<BudgetReservation>{
    if(!Number.isFinite(actualUsd)||actualUsd<0)throw new Error('Actual cost must be a non-negative finite amount');
    const reservation=this.job(jobId).reservations.get(reservationId);
    if(!reservation)throw new Error(`Unknown budget reservation ${reservationId}`);
    if(reservation.status==='settled'){
      if(Math.abs((reservation.actualUsd??0)-actualUsd)>1e-9)throw new Error(`Reservation ${reservationId} is already settled with a different amount`);
      return {...reservation};
    }
    if(reservation.status==='released')throw new Error(`Reservation ${reservationId} is already released`);
    reservation.status='settled';reservation.actualUsd=actualUsd;
    return {...reservation};
  }

  async release(jobId:string,reservationId:string):Promise<BudgetReservation>{
    const reservation=this.job(jobId).reservations.get(reservationId);
    if(!reservation)throw new Error(`Unknown budget reservation ${reservationId}`);
    if(reservation.status==='settled')return {...reservation};
    reservation.status='released';reservation.actualUsd=0;
    return {...reservation};
  }

  async state(jobId:string,limitUsd:number):Promise<BudgetState>{
    const ledger=this.job(jobId);const totals=this.totals(ledger);
    return {jobId,limitUsd,plannedUsd:ledger.plannedUsd,...totals,availableUsd:Math.max(0,limitUsd-totals.reservedUsd-totals.spentUsd),calls:ledger.reservations.size};
  }

  private totals(ledger:JobLedger):{reservedUsd:number;spentUsd:number}{
    let reservedUsd=0,spentUsd=0;
    for(const reservation of ledger.reservations.values()){
      if(reservation.status==='reserved')reservedUsd+=reservation.estimatedUsd;
      if(reservation.status==='settled')spentUsd+=reservation.actualUsd??0;
    }
    return {reservedUsd,spentUsd};
  }
}
