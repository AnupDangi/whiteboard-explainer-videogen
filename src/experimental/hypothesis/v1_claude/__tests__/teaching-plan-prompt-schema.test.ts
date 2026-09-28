import assert from 'node:assert/strict';
import test from 'node:test';
import { PLAN_PROMPT_VARIANTS, PLAN_VARIANT_OUTPUT, TEACHING_PLAN_PROMPT_SCHEMA_RULES } from '../plan/stages.js';
import { RELATION_TYPES, SECTION_KINDS, SECTION_TITLE_MAX_WORDS, TeachingPlanSchema, TEACHING_SKILLS, VISUAL_MECHANISMS } from '../plan/schemas.js';

test('every S3 prompt variant spells out schema constraints and uses the schema enums', () => {
  const context = {
    scenes: 1,
    req: { source: 'source text', targetDurationSec: 18 },
    graph: { concepts: [], relations: [], prerequisites: [] },
    conceptIdChecklist: '',
  };

  for (const [name, build] of Object.entries(PLAN_PROMPT_VARIANTS)) {
    const { system } = build(context);
    assert.ok(SECTION_KINDS.every((kind) => system.includes(kind)), `${name} section kind enum`);
    assert.ok(TEACHING_SKILLS.every((skill) => system.includes(skill)), `${name} teaching skill enum`);
    assert.ok(VISUAL_MECHANISMS.every((mechanism) => system.includes(mechanism)), `${name} visual mechanism enum`);
    if (PLAN_VARIANT_OUTPUT[name as keyof typeof PLAN_VARIANT_OUTPUT] === 'full') {
      // v3-v5: the model copies each SceneContract, so its limits and the relation enum must be stated.
      assert.match(system, new RegExp(`title is 1-${SECTION_TITLE_MAX_WORDS} words`), `${name} title constraint`);
      assert.ok(RELATION_TYPES.every((type) => system.includes(type)), `${name} relation type enum`);
      assert.match(system, /unknown fields at every object level/);
      assert.match(system, /Every generated section requires a contract/);
    } else {
      // v6: contracts are derived in code; the prompt states the draft limits and the grouping rule.
      assert.match(system, new RegExp(`title: at most ${SECTION_TITLE_MAX_WORDS} words`), `${name} title constraint`);
      assert.match(system, /no other fields/);
      assert.match(system, /a relation is taught only in a section whose conceptIds contain BOTH of its endpoints/);
      assert.match(system, /intro\.sections: use short outline headings of 2-5 words, each under 60 characters/);
      assert.doesNotMatch(system, /requiredRelations|lessonBible/, `${name} must not ask the model to copy derived fields`);
      assert.match(system, /essentialClaims/, `${name} must identify source-backed claims to say and depict`);
    }
  }
});

test('S3 schema rejects an overlong section title and an unsupported section kind', () => {
  const validPlan = {
    targetDurationSec: 18,
    intro: { sourceTitle: 'A source title', sections: ['Overview'] },
    lessonBible: { audience: 'general learner', terminology: [], persistentConceptIds: [] },
    sections: [{ id: 'section_one', title: 'A concise section title', goal: 'Explain the central idea.', kind: 'explain', conceptIds: ['central_idea'], budgetSec: 18 }],
    recap: { keyPoints: ['The central idea.'] },
  };
  assert.equal(TeachingPlanSchema.safeParse(validPlan).success, true);
  assert.equal(TeachingPlanSchema.safeParse({ ...validPlan, sections: [{ ...validPlan.sections[0], title: 'This title contains exactly eight distinct words here' }] }).success, false);
  assert.equal(TeachingPlanSchema.safeParse({ ...validPlan, sections: [{ ...validPlan.sections[0], kind: 'transition' }] }).success, false);
  assert.match(TEACHING_PLAN_PROMPT_SCHEMA_RULES, /title is 1-7 words/);
});
