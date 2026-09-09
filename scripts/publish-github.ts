/** Explicit user-run publication; private unless --public is supplied. */
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const run=(cmd,args)=>{const r=spawnSync(cmd,args,{cwd:root,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status||1);};
const args=process.argv.slice(2),repo=args.find(a=>!a.startsWith('--'))||'explain-canvas-lab';
if(!/^[a-zA-Z0-9_.-]+$/.test(repo))throw new Error('Use a repository name without owner or URL.');
if(!args.includes('--publish'))throw new Error('Run npm run publish:github -- explain-canvas-lab --publish to create a PRIVATE repository and push.');
run('gh',['auth','status']);run('git',['init','-b','main']);run('git',['add','.']);
const changed=spawnSync('git',['diff','--cached','--quiet'],{cwd:root});
if(changed.status===1)run('git',['commit','-m','Build hypothesis-driven whiteboard explainer prototype']);
run('gh',['repo','create',repo,args.includes('--public')?'--public':'--private','--source','.','--remote','origin','--push','--description','Scene data, deterministic whiteboard animation, progressive playback and hypothesis tests']);
