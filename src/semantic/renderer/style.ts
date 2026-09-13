export const COLORS={ink:'#233832',green:'#367354',blue:'#3481a3',amber:'#ce972b',earth:'#947154',red:'#bd6559',paper:'#faf9f3'};
export const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
export const clamp=(n:number)=>Math.max(0,Math.min(1,n));
