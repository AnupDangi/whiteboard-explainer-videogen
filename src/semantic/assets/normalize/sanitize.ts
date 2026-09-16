/** Fail-closed SVG sanitizer. External SVG is untrusted markup, so anything not
 *  on a strict allow-list is rejected rather than stripped: a partially-understood
 *  document must never reach the converter. Only the geometry elements the
 *  converter actually reads are permitted, and no reference of any kind is
 *  allowed to leave the document.
 *
 *  Rejected: script/foreignObject/iframe/image/use/text/style/defs/filter/mask/
 *  clipPath/pattern/marker/animation/SMIL, event handlers, href/xlink:href,
 *  CSS url(...), javascript:, external URLs, entities and processing
 *  instructions. Every failure throws; nothing degrades silently. */
const ALLOWED_TAGS=new Set(['svg','g','path','rect','circle','ellipse','line','polyline','polygon']);
const FORBIDDEN_ELEMENT=/<\s*(?:script|foreignObject|iframe|image|use|animate|animateTransform|animateMotion|set|style|filter|mask|clipPath|pattern|marker|text|tspan|a|switch|symbol|defs|desc|title|metadata)\b/i;
const EVENT_HANDLER=/\son[a-z]+\s*=/i;
const EXTERNAL_REF=/(?:xlink:)?href\s*=|url\s*\(|<!ENTITY|<\?xml-stylesheet|javascript:/i;
const EXTERNAL_URL=/https?:\/\//i;
const INLINE_STYLE=/\sstyle\s*=/i;

export interface SanitizeResult {svg:string;elementCount:number}

export function sanitizeSvg(input:string):SanitizeResult{
 if(typeof input!=='string'||!input.trim())throw new Error('SVG sanitizer: empty input');
 if(input.length>200_000)throw new Error('SVG sanitizer: input exceeds 200k characters');
 if(!/<svg[\s>]/i.test(input))throw new Error('SVG sanitizer: missing <svg> root');
 if(FORBIDDEN_ELEMENT.test(input))throw new Error(`SVG sanitizer: forbidden element (${input.match(FORBIDDEN_ELEMENT)![1]})`);
 if(EVENT_HANDLER.test(input))throw new Error('SVG sanitizer: event handler attribute');
 if(EXTERNAL_REF.test(input))throw new Error('SVG sanitizer: external or scripting reference');
 /** `xmlns="http://www.w3.org/2000/svg"` is a NAMESPACE declaration, not a
  *  fetch: every real icon carries it. Namespace declarations are removed before
  *  the URL check so the check still rejects an actual external reference, which
  *  is what `href`/`url(...)` already cover. Without this the sanitizer rejected
  *  every icon from every provider. */
 const withoutNamespaceDeclarations=input.replace(/\sxmlns(?::[\w-]+)?\s*=\s*(?:"[^"]*"|'[^']*')/gi,' ');
 if(EXTERNAL_URL.test(withoutNamespaceDeclarations))throw new Error('SVG sanitizer: external URL');
 if(INLINE_STYLE.test(input))throw new Error('SVG sanitizer: inline style is not allowed; use presentation attributes');
 let elementCount=0;
 for(const match of input.matchAll(/<\s*\/?\s*([a-zA-Z][\w:-]*)/g)){
  const tag=match[1];
  if(!ALLOWED_TAGS.has(tag))throw new Error(`SVG sanitizer: forbidden element <${tag}>`);
  if(!match[0].startsWith('</'))elementCount++;
 }
 if(!elementCount)throw new Error('SVG sanitizer: no elements');
 return {svg:input,elementCount};
}
