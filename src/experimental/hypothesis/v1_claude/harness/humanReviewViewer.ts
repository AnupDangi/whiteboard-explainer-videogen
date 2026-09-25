import type { E1BlindParticipantPack } from './humanReview.js';

/** Build a self-contained local HTML form; it loads only images beside the page. */
export function buildE1ReviewHtml(pack: E1BlindParticipantPack): string {
  const embedded = JSON.stringify(pack).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Blind visual review</title><style>
  :root{color-scheme:light;font:16px/1.45 system-ui,sans-serif;color:#20242b;background:#f3f5f7}*{box-sizing:border-box}
  body{max-width:1100px;margin:0 auto;padding:24px}header{position:sticky;top:0;background:#f3f5f7ee;padding:12px 0;z-index:2;border-bottom:1px solid #ccd2d9}
  h1{font-size:1.5rem;margin:0 0 4px}header p{margin:0 0 10px;color:#4b5563}.actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  button{border:0;border-radius:8px;background:#174e79;color:white;padding:10px 16px;font:inherit;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}
  #status{color:#374151}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;padding-top:18px}
  article{background:white;border:1px solid #d7dce2;border-radius:12px;padding:14px;box-shadow:0 2px 8px #17212b0a}h2{font-size:1rem;margin:0 0 10px;color:#4b5563}
  img{display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:contain;background:#e8ebef;border-radius:8px;margin-bottom:14px}
  .field{display:flex;align-items:center;gap:12px;margin:10px 0}.field strong{min-width:132px}.choice{display:flex;gap:10px}.choice label{display:flex;gap:4px;align-items:center}
  @media print{header{position:static}.grid{display:block}article{break-inside:avoid;margin:10px 0}}
</style></head><body>
<header><h1>Blind visual review</h1><p>For each image, assign anonymous source group A or B and rate visual style coherence from 1 to 5. Work independently.</p>
<div class="actions"><button id="download" type="button" disabled>Download vote JSON</button><span id="status" role="status">Complete both ratings for every image.</span></div></header>
<main class="grid" id="items"></main>
<script type="application/json" id="review-pack">${embedded}</script>
<script>
(() => {
  const pack = JSON.parse(document.getElementById('review-pack').textContent);
  const root = document.getElementById('items');
  const cards = new Map();
  for (const [index, item] of pack.items.entries()) {
    const card = document.createElement('article');
    const heading = document.createElement('h2'); heading.textContent = 'Image ' + (index + 1);
    const image = document.createElement('img'); image.src = item.imagePath; image.alt = 'Anonymous teaching-video frame ' + (index + 1); image.loading = 'lazy';
    const sourceField = document.createElement('div'); sourceField.className = 'field';
    const sourceLabel = document.createElement('strong'); sourceLabel.textContent = 'Source group'; sourceField.append(sourceLabel);
    const sourceChoices = document.createElement('div'); sourceChoices.className = 'choice';
    for (const group of ['A', 'B']) {
      const label = document.createElement('label'); const input = document.createElement('input');
      input.type = 'radio'; input.name = 'source-' + item.itemId; input.value = group;
      input.addEventListener('change', updateStatus); label.append(input, document.createTextNode(group)); sourceChoices.append(label);
    }
    sourceField.append(sourceChoices);
    const styleField = document.createElement('div'); styleField.className = 'field';
    const styleLabel = document.createElement('strong'); styleLabel.textContent = 'Style coherence'; styleField.append(styleLabel);
    const styleChoices = document.createElement('div'); styleChoices.className = 'choice';
    for (const score of [1, 2, 3, 4, 5]) {
      const label = document.createElement('label'); const input = document.createElement('input');
      input.type = 'radio'; input.name = 'style-' + item.itemId; input.value = String(score);
      input.addEventListener('change', updateStatus); label.append(input, document.createTextNode(String(score))); styleChoices.append(label);
    }
    styleField.append(styleChoices); card.append(heading, image, sourceField, styleField); root.append(card);
    cards.set(item.itemId, card);
  }
  const button = document.getElementById('download'); const status = document.getElementById('status');
  function values(itemId, name) { return document.querySelector('input[name="' + name + '-' + itemId + '"]:checked')?.value; }
  function updateStatus() {
    let completed = 0;
    for (const itemId of cards.keys()) if (values(itemId, 'source') && values(itemId, 'style')) completed++;
    status.textContent = completed + ' / ' + cards.size + ' images rated.';
    button.disabled = completed !== cards.size;
  }
  button.addEventListener('click', () => {
    const vote = { schemaVersion: 'e1-human-vote/v1', packageId: pack.packageId, participantId: pack.participantId,
      votes: pack.items.map((item) => ({ itemId: item.itemId, sourceGroup: values(item.itemId, 'source'), styleCoherence: Number(values(item.itemId, 'style')) })) };
    const blob = new Blob([JSON.stringify(vote, null, 2) + '\\n'], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = pack.participantId + '-votes.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
})();
</script></body></html>\n`;
}
