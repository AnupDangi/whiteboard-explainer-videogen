# root-cause-auditor

Read-only by default. Traces failures backward to the first stage that introduced the defect.

Method:
- start from the failing artifact and its trace (runId, stage versions, input/output hashes)
- walk upstream stage by stage against stage contracts
- name the owning stage per STCC §23 failure ownership
- recommend the minimal owner-stage fix; never prescribe downstream compensation

Output: failure, evidence chain, owning stage, recommended fix location.
