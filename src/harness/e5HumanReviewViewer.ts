import type { E5BlindParticipantPack } from './e5HumanReview.js';

/** Self-contained timed-video reviewer UI. It receives only opaque video names and pair IDs. */
export function buildE5ReviewHtml(pack: E5BlindParticipantPack): string {
  const embedded = JSON.stringify(pack).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Blind timed-video review</title><style>
:root{color-scheme:light;font:16px/1.45 system-ui,sans-serif;color:#20242b;background:#f3f5f7}*{box-sizing:border-box}
body{max-width:1400px;margin:0 auto;padding:24px}header{position:sticky;top:0;background:#f3f5f7ee;padding:12px 0;z-index:2;border-bottom:1px solid #ccd2d9}
h1{font-size:1.5rem;margin:0 0 5px}.muted{color:#4b5563;margin:0 0 10px}.actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
button{border:0;border-radius:8px;background:#174e79;color:white;padding:9px 14px;font:inherit;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}
#status{color:#374151}.pair{background:white;border:1px solid #d7dce2;border-radius:12px;padding:16px;margin:18px 0;box-shadow:0 2px 8px #17212b0a}
.videos{display:grid;grid-template-columns:1fr 1fr;gap:14px}.side{min-width:0}.side h3{text-align:center;margin:4px 0 8px}
video{display:block;width:100%;aspect-ratio:16/9;background:#111;border-radius:8px}.pair-controls{display:flex;gap:10px;align-items:center;margin:12px 0}.pair-controls input{flex:1}
.ratings{display:grid;grid-template-columns:repeat(3,minmax(180px,1fr));gap:10px}.rating{border:1px solid #e0e4e8;border-radius:8px;padding:10px}.rating label{display:block;margin:6px 0}.rating select{font:inherit;width:100%;padding:5px}
@media(max-width:760px){.videos,.ratings{grid-template-columns:1fr}.pair{padding:10px}}
</style></head><body>
<header><h1>Blind timed-video comparison</h1><p class="muted">Review each complete video with audio. A/B order is randomized. The two versions share the same narration and duration.</p>
<div class="actions"><button id="download" type="button" disabled>Download vote JSON</button><span id="status" role="status">Complete every rating for each pair.</span></div></header>
<main id="pairs"></main><script type="application/json" id="review-pack">${embedded}</script>
<script>
(() => {
  const pack = JSON.parse(document.getElementById('review-pack').textContent);
  const root = document.getElementById('pairs'); const states = new Map();
  const select = (name, options) => { const el=document.createElement('select'); el.name=name; const blank=document.createElement('option'); blank.value=''; blank.textContent='Select…'; el.append(blank); for(const [value,label] of options){const option=document.createElement('option');option.value=value;option.textContent=label;el.append(option)} return el; };
  for (const [index,pair] of pack.pairs.entries()) {
    const article=document.createElement('section');article.className='pair';article.dataset.itemId=pair.itemId;
    const title=document.createElement('h2');title.textContent='Pair '+(index+1);article.append(title);
    const videos=document.createElement('div');videos.className='videos';const leftWrap=document.createElement('div');leftWrap.className='side';const rightWrap=document.createElement('div');rightWrap.className='side';
    const leftTitle=document.createElement('h3');leftTitle.textContent='Video A';const rightTitle=document.createElement('h3');rightTitle.textContent='Video B';
    const left=document.createElement('video');left.src=pair.leftVideo;left.preload='metadata';left.playsInline=true;
    const right=document.createElement('video');right.src=pair.rightVideo;right.preload='metadata';right.playsInline=true;right.muted=true;
    leftWrap.append(leftTitle,left);rightWrap.append(rightTitle,right);videos.append(leftWrap,rightWrap);article.append(videos);
    const controls=document.createElement('div');controls.className='pair-controls';
    const play=document.createElement('button');play.textContent='Play both';const pause=document.createElement('button');pause.textContent='Pause';
    const seek=document.createElement('input');seek.type='range';seek.min='0';seek.max='1000';seek.value='0';seek.setAttribute('aria-label','Seek both videos');
    play.addEventListener('click',()=>{const time=Math.min(left.currentTime,right.currentTime);left.currentTime=time;right.currentTime=time;left.play().catch(()=>{});right.play().catch(()=>{})});
    pause.addEventListener('click',()=>{left.pause();right.pause()});
    seek.addEventListener('input',()=>{const duration=Math.min(left.duration||0,right.duration||0);if(duration>0){const time=Number(seek.value)/1000*duration;left.currentTime=time;right.currentTime=time}});
    left.addEventListener('timeupdate',()=>{const duration=Math.min(left.duration||0,right.duration||0);if(duration>0){const value=left.currentTime/duration*1000;seek.value=String(value);if(Math.abs(left.currentTime-right.currentTime)>.15)right.currentTime=left.currentTime}});
    controls.append(play,pause,seek);article.append(controls);
    const ratings=document.createElement('div');ratings.className='ratings';
    const makeRating=(label,name)=>{const box=document.createElement('div');box.className='rating';const heading=document.createElement('strong');heading.textContent=label;const field=select(name,Array.from({length:5},(_,i)=>[String(i+1),String(i+1)]));field.addEventListener('change',update);box.append(heading,field);return box};
    const preference=document.createElement('div');preference.className='rating';const prefTitle=document.createElement('strong');prefTitle.textContent='Which teaches the mechanism more clearly?';const pref=select('preferred',[['A','A'],['B','B'],['tie','Tie']]);pref.addEventListener('change',update);preference.append(prefTitle,pref);
    ratings.append(preference,makeRating('Clarity · A','clarityA'),makeRating('Clarity · B','clarityB'),makeRating('Mechanism explanation · A','mechanismA'),makeRating('Mechanism explanation · B','mechanismB'));
    const concernBox=document.createElement('div');concernBox.className='rating';const concernTitle=document.createElement('strong');concernTitle.textContent='Factual concern';
    const concernA=document.createElement('input');concernA.type='checkbox';concernA.name='factualConcernA';concernA.addEventListener('change',update);const labelA=document.createElement('label');labelA.append(concernA,document.createTextNode(' A has an unsupported or misleading claim'));
    const concernB=document.createElement('input');concernB.type='checkbox';concernB.name='factualConcernB';concernB.addEventListener('change',update);const labelB=document.createElement('label');labelB.append(concernB,document.createTextNode(' B has an unsupported or misleading claim'));
    concernBox.append(concernTitle,labelA,labelB);ratings.append(concernBox);article.append(ratings);root.append(article);states.set(pair.itemId,article);
  }
  const status=document.getElementById('status');const download=document.getElementById('download');
  function value(item,name){return item.querySelector('[name="'+name+'"]')?.value||''}
  function update(){let complete=0;for(const [id,item] of states){if(value(item,'preferred')&&value(item,'clarityA')&&value(item,'clarityB')&&value(item,'mechanismA')&&value(item,'mechanismB'))complete++}status.textContent=complete+' / '+states.size+' pairs reviewed.';download.disabled=complete!==states.size}
  download.addEventListener('click',()=>{const votes=pack.pairs.map(pair=>{const item=states.get(pair.itemId);return{itemId:pair.itemId,preferred:value(item,'preferred'),clarityA:Number(value(item,'clarityA')),clarityB:Number(value(item,'clarityB')),mechanismA:Number(value(item,'mechanismA')),mechanismB:Number(value(item,'mechanismB')),factualConcernA:Boolean(item.querySelector('[name="factualConcernA"]').checked),factualConcernB:Boolean(item.querySelector('[name="factualConcernB"]').checked)}});const result={schemaVersion:'e5-human-vote/v1',packageId:pack.packageId,participantId:pack.participantId,votes};const blob=new Blob([JSON.stringify(result,null,2)+'\\n'],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=pack.participantId+'-votes.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000)});
})();
</script></body></html>\n`;
}
