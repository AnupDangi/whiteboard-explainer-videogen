import test from 'node:test';
import assert from 'node:assert/strict';
import {NODE_KINDS} from '../dist/src/vocabulary.js';
import {renderIcon,hasIcon} from '../dist/src/icons.js';
import {renderIllustration,hasIllustration} from '../dist/src/illustrations.js';

// Every kind the director can emit must render a working glyph — no broken paths,
// no empty output. Catches icon regressions for all 50 kinds in one place.
test('all icon kinds render non-empty glyph markup',()=>{
  for(const kind of NODE_KINDS){
    if(kind==='generic'){assert.equal(renderIcon(kind,100,100,20,'#000'),'');continue;}
    assert(hasIcon(kind),`${kind} must have an icon`);
    const svg=renderIcon(kind,100,100,20,'#243a41');
    assert(svg.length>20,`${kind} glyph must be non-trivial`);
    assert(svg.includes('<'),`${kind} glyph must be SVG markup`);
  }
});

test('all illustration kinds render staged figures',()=>{
  const illustrated=NODE_KINDS.filter(hasIllustration);
  assert(illustrated.length>=6,'illustration library must keep growing, never shrink');
  for(const kind of illustrated){
    const svg=renderIllustration(kind,0,0,300,300,1,'#243a41','#d9edf4');
    assert(svg.length>50,`${kind} illustration must be non-trivial`);
    const early=renderIllustration(kind,0,0,300,300,0.1,'#243a41','#d9edf4');
    assert(!early.includes('fill-opacity'),'no fill wash at 10% progress');
  }
});
