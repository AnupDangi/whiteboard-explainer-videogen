/** Teacher Planner contracts (`Architecture_plan.md` §16-25). The teacher owns
 *  the lesson architecture; a scene is a learner delta, never a concept node.
 *  No geometry, no narration text beyond an intent — the Scene Worker writes
 *  narration in W4. */
export interface ContinuityPlan {
  throughline:string;
  persistentConceptIds:string[];
}

export interface SceneContract {
  id:string;
  sequence:number;
  learningDelta:string;
  requiredConceptIds:string[];
  requiredRelations:string[];
  mechanismIds:string[];
  evidenceRefs:string[];
  targetDurationSec:number;
  narrationIntent:string;
  candidateArchetypes:string[];
  continuityIn:string[];
  continuityOut:string[];
}

export interface LessonGraph {
  title:string;
  lessonGoal:string;
  targetDurationSec:number;
  scenes:SceneContract[];
  continuity:ContinuityPlan;
  endingGoal:string;
}

export interface ConceptIdentity {
  canonicalName:string;
  aliases:string[];
}

export interface VisualIdentity {
  representationFamily:string;
  colorRole?:string;
}

export interface Analogy {conceptId:string;analogy:string;markedAsPedagogical:true}

export interface LessonBible {
  canonicalTerminology:Record<string,string>;
  conceptIdentity:Record<string,ConceptIdentity>;
  visualIdentity:Record<string,VisualIdentity>;
  analogies:Record<string,Analogy>;
  narrativeStyle:string;
  learnerLevel:string;
  persistentObjects:string[];
  introducedConceptsByScene:Record<string,string[]>;
  forbiddenRepetition:string[];
}

export interface LessonPlan {lessonGraph:LessonGraph;lessonBible:LessonBible}
