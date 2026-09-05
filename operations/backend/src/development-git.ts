import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir} from 'node:fs/promises';
const exec=promisify(execFile);
const specs=[['初见前端','frontend'],['初见后端','backend'],['运营前端','operations/frontend'],['运营后端','operations/backend']];
const extensions=['ts','tsx','js','jsx','mjs','cjs','css','scss','html','vue','svelte','sql','py','sh','go','rs','java'];
const excluded=['node_modules','dist','out','build','coverage','.next','vendor','generated'];
let pending:ReturnType<typeof collect>|undefined;
const dir=process.env.OPERATIONS_GIT_CACHE||'/tmp/operations-development-git';
async function git(args:string[]){
 const token=process.env.OPERATIONS_GITHUB_TOKEN;
 const env={...process.env,GIT_TERMINAL_PROMPT:'0',...(token?{GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.https://github.com/.extraheader',GIT_CONFIG_VALUE_0:`Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`}:{})};
 try{return (await exec('git',['-C',dir,...args],{env,timeout:180000,maxBuffer:64*1024*1024})).stdout;}catch{throw new Error('完整 Git 仓库采集失败，请检查数据源连接');}
}
function pathspec(path:string){return [...extensions.map(ext=>`:(glob)${path}/**/*.${ext}`),...excluded.map(x=>`:(exclude,glob)**/${x}/**`),':(exclude,glob)**/*.min.js',':(exclude,glob)**/*.d.ts',':(exclude,glob)**/generated.*'];}
export async function collectGitReleases(){
 if(pending)return pending;
 pending=collect().finally(()=>{pending=undefined});return pending;
}
async function collect(){
 await mkdir(dir,{recursive:true});await git(['init','--bare']);
 const repo=process.env.OPERATIONS_GITHUB_REPOSITORY||'jiucongtian/M-satori';
 if(!/^[\w.-]+\/[\w.-]+$/.test(repo))throw new Error('仓库配置无效');
 await git(['fetch','--no-tags',`https://github.com/${repo}.git`,'+refs/heads/release/r1.0:refs/heads/release/r1.0','+refs/heads/release/r1.1:refs/heads/release/r1.1']);
 const releases=[];
 for(const name of ['R1.0','R1.1']){
  const ref=`release/${name.toLowerCase()}`,sha=(await git(['rev-parse',ref])).trim();
  const baseline=name==='R1.1'?(await git(['merge-base','release/r1.0',sha])).trim():null;
  const range=baseline?`${baseline}..${sha}`:sha;
  const components=[];
  for(const [component,path] of specs){
   const lines=await git(['ls-tree','-r','--name-only',sha,'--',path]);
   const sources=lines.trim().split('\n').filter(f=>extensions.some(e=>f.endsWith(`.${e}`))&&!excluded.some(e=>f.split('/').includes(e))&&!/\.min\.js$|\.d\.ts$|\/generated\.[^/]+$/.test(f));
   let counts='';if(sources.length)counts=await git(['grep','-I','-c','^',sha,'--',...pathspec(path)]);
   const lineCount=counts.split('\n').reduce((n,row)=>n+(Number(row.slice(row.lastIndexOf(':')+1))||0),0);
   const commits=Number((await git(['rev-list','--count',range,'--',path])).trim());
   const historyCommits=Number((await git(['rev-list','--count',sha,'--',path])).trim());
   const latest=(await git(['log','-1','--format=%h',sha,'--',path])).trim();
   const diff=await git(['diff','--numstat',baseline||'4b825dc642cb6eb9a060e54bf8d69288fbee4904',sha,'--',...pathspec(path)]);
   const changes=diff.trim().split('\n').filter(Boolean).map(row=>{const [a,b,...p]=row.split('\t');return {filename:p.join('\t'),additions:Number(a)||0,deletions:Number(b)||0};});
   components.push({name:component,path,sha:latest||'无提交',commits,historyCommits,totalLines:lineCount,sourceFiles:sources.length,testCases:sources.filter(f=>/(?:test|spec)\.[^.]+$/.test(f)).length,additions:changes.reduce((n,x)=>n+x.additions,0),deletions:changes.reduce((n,x)=>n+x.deletions,0),files:changes});
  }
  const log=await git(['log','--format=%H%x09%aI%x09%s',range]);
  const commits=log.trim().split('\n').filter(Boolean).map(row=>{const [id,date,...message]=row.split('\t');return {sha:id,date,message:message.join('\t')};});
  releases.push({name,sha,baseline,components,commits,totalLines:components.reduce((n,c)=>n+c.totalLines,0)});
 }
 return releases;
}
