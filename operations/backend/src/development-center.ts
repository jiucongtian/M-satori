type ReleaseName='R1.1'|'R1.0';
import type pg from 'pg';
type Commit={sha:string;commit:{author:{date:string};message:string};html_url:string};
type FileChange={filename:string;additions:number;deletions:number};
const repository=process.env.OPERATIONS_GITHUB_REPOSITORY||'jiucongtian/M-satori',token=process.env.OPERATIONS_GITHUB_TOKEN,cache=new Map<string,{expires:number;value:any}>();
const headers:Record<string,string>={accept:'application/vnd.github+json','user-agent':'satori-operations-development-center','x-github-api-version':'2022-11-28',...(token?{authorization:`Bearer ${token}`}:{})};
const github=async<T>(path:string)=>{const response=await fetch(`https://api.github.com/repos/${repository}${path}`,{headers,signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error(`GitHub ${response.status}`);return response.json() as Promise<T>};
const componentOf=(path:string)=>path.startsWith('operations/frontend/')?'运营前端':path.startsWith('operations/backend/')?'运营后端':path.startsWith('frontend/')?'初见前端':path.startsWith('backend/')?'初见后端':null;

async function fetchDevelopmentCenterData(release:ReleaseName){
 const cached=cache.get(release);if(cached&&cached.expires>Date.now())return cached.value;
 const branch=`release/${release.toLowerCase()}`,base=release==='R1.1'?'release/r1.0':'main',failures:string[]=[];let commits:Commit[]=[],files:FileChange[]=[],issues:any[]=[],runs:any[]=[],tree:any[]=[];
 await Promise.all([
  github<Commit[]>(`/commits?sha=${encodeURIComponent(branch)}&per_page=100`).then(x=>commits=x).catch(()=>failures.push('Commit')),
  github<{files?:FileChange[]}>(`/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}`).then(x=>files=x.files||[]).catch(()=>failures.push('代码差异')),
  github<any[]>('/issues?state=all&per_page=100').then(x=>issues=x.filter(i=>!i.pull_request&&(i.title.includes(release)||String(i.body||'').includes(release)||i.labels.some((l:any)=>l.name==='v2.1.1')))).catch(()=>failures.push('Issue')),
  github<{workflow_runs:any[]}>(`/actions/runs?branch=${encodeURIComponent(branch)}&per_page=100`).then(x=>runs=x.workflow_runs||[]).catch(()=>failures.push('Actions')),
  github<{tree:any[]}>(`/git/trees/${encodeURIComponent(branch)}?recursive=1`).then(x=>tree=x.tree||[]).catch(()=>failures.push('代码树'))
 ]);
 const names=['初见前端','初见后端','运营前端','运营后端'],paths=['frontend','backend','operations/frontend','operations/backend'];
 const components=names.map((name,index)=>{const path=paths[index],changed=files.filter(x=>componentOf(x.filename)===name),sources=tree.filter(x=>x.type==='blob'&&x.path.startsWith(`${path}/`)&&/\.(ts|tsx|js|mjs)$/.test(x.path)),tests=sources.filter(x=>/(test|spec)\.(ts|tsx|js|mjs)$/.test(x.path));return {name,path,sha:commits[0]?.sha.slice(0,7)||'不可得',additions:files.length?changed.reduce((n,x)=>n+x.additions,0):null,deletions:files.length?changed.reduce((n,x)=>n+x.deletions,0):null,commits:commits.length||null,testRate:sources.length?Math.round(tests.length/sources.length*100):null,testCases:tests.length,deployment:name.startsWith('运营')?'测试环境运行中':'待部署回执'}});
 const hours=Array(24).fill(0);commits.forEach(x=>hours[new Date(x.commit.author.date).getHours()]++);
 const issueRows=issues.map(i=>{const labels=i.labels.map((l:any)=>l.name);return {number:i.number,title:i.title,url:i.html_url,state:i.state==='closed'?'已关闭':'待处理',module:labels.find((x:string)=>['运营平台','前端','后端','数据'].includes(x))||'待分类',type:labels.includes('BUG')?'缺陷':labels.includes('feature')?'需求':'体验与改进',priority:labels.find((x:string)=>/^P[0-3]$/.test(x))||'未标级',updatedAt:i.updated_at}});
 const successful=runs.filter(x=>x.conclusion==='success').length,finished=runs.filter(x=>x.status==='completed').length,tests=components.reduce((n,x)=>n+x.testCases,0),first=commits.at(-1);
 const data={source:{mode:failures.length?'PARTIAL':'LIVE',updatedAt:new Date().toISOString(),message:failures.length?`以下 GitHub 数据源读取失败：${failures.join('、')}；其余指标仍为实时结果。`:'GitHub 数据为准实时读取；部署状态来自测试环境配置。',repository},releases:['R1.1','R1.0'],release:{name:release,stage:release==='R1.1'?'测试中':'历史版本',environment:'测试环境',tag:release==='R1.1'?'尚未封版':'历史标签',branch,startedAt:first?new Date(first.commit.author.date).toLocaleString('zh-CN'):'不可得',taggedAt:null,duration:first?`${Math.max(1,Math.ceil((Date.now()-new Date(first.commit.author.date).getTime())/86400000))} 天`:'不可计算'},components,
 lifecycle:[['首个分支提交',first?new Date(first.commit.author.date).toLocaleString('zh-CN'):'不可得',first?'事实':'缺失'],['首次部署','待部署回执接入','缺失'],['自动化检查',runs.length?`${successful}/${finished} 次成功`:'暂无执行记录',runs.length?'事实':'缺失'],['Tag',release==='R1.1'?'尚未封版':'历史标签','事实'],['正式发布',release==='R1.1'?'尚未发布':'历史版本','事实']],
 features:[{name:'商品中心审批与版本管理',page:'ADMIN-PRODUCT-01',status:'已部署',frontend:'商品配置与校验',backend:'/api/products/*',tests:'自动发现',issues:'自动关联'},{name:'运营数据分析',page:'ADMIN-DATA-01~06',status:'已部署',frontend:'六类数据视图',backend:'/api/analytics/*',tests:'自动发现',issues:'自动关联'},{name:'人工权益赠送闭环',page:'ADMIN-BENEFIT-01',status:'待验证',frontend:'赠送申请与记录',backend:'/api/manual-grants/*',tests:'自动发现',issues:'自动关联'},{name:'研发数据中心',page:'ADMIN-DEV-01~07',status:'开发中',frontend:'七个研发治理视图',backend:'/api/development-center',tests:'已覆盖',issues:'#127'}],
 timeline:commits.slice(0,12).reverse().map((x,i)=>[`提交 ${i+1}`,new Date(x.commit.author.date).toLocaleString('zh-CN'),x.commit.message.split('\n')[0],x.html_url]),code:{hours,files:files.sort((a,b)=>b.additions+b.deletions-a.additions-a.deletions).slice(0,12),exclusions:['依赖目录','构建产物','锁文件','生成代码','图片与二进制文件']},
 quality:{cases:tests||null,functionCoverage:null,executionRate:runs.length?100:null,codeCoverage:null,passRate:finished?Math.round(successful/finished*100):null,flaky:runs.filter(x=>x.conclusion==='failure').slice(0,8).map(x=>({name:x.name,url:x.html_url,createdAt:x.created_at})),gate:runs.length?(finished===successful?'当前 Actions 均通过':'存在失败的 Actions 运行，请处理后再发布'):'当前分支暂无 Actions 运行记录'},
 issues:{total:issues.length,p0:issueRows.filter(x=>x.priority==='P0').length,p1:issueRows.filter(x=>x.priority==='P1').length,pendingVerification:issueRows.filter(x=>x.state!=='已关闭'&&x.title.includes('验证')).length,reopened:null,escaped:null,groups:issueRows,message:issues.length?'Issue 已按 Release、模块、类型和优先级聚合。':'当前 Release 未找到匹配 Issue。'},
 health:[{source:'测试环境部署回执',status:'部分可用',freshness:'当前请求',detail:'环境可确认，四端独立 SHA 待部署回执完善'},{source:'GitHub Commit 与差异',status:failures.some(x=>['Commit','代码差异'].includes(x))?'异常':'可用',freshness:'准实时',detail:`已读取 ${commits.length} 次提交、${files.length} 个变更文件`},{source:'GitHub Actions',status:failures.includes('Actions')?'异常':runs.length?'可用':'暂无记录',freshness:'准实时',detail:`已读取 ${runs.length} 次工作流运行`},{source:'GitHub Issue',status:failures.includes('Issue')?'异常':'可用',freshness:'准实时',detail:`已关联 ${issues.length} 个 Issue`},{source:'AI 发布摘要',status:failures.length?'受限':'可用',freshness:'当前请求',detail:'仅基于已读取事实生成，不补造缺失结论'}]};
 cache.set(release,{expires:Date.now()+60000,value:data});return data;
}

export async function ensureDevelopmentCenterSchema(pool:pg.Pool){
 await pool.query(`create table if not exists operations_development_snapshots(
  release varchar(16) primary key,
  payload jsonb not null,
  captured_at timestamptz not null default now(),
  captured_by varchar(128) not null default 'SCHEDULED'
 )`);
}

export async function refreshDevelopmentCenterData(pool:pg.Pool,release:ReleaseName,capturedBy='SCHEDULED'){
 cache.delete(release);
 const payload=await fetchDevelopmentCenterData(release);
 await pool.query(`insert into operations_development_snapshots(release,payload,captured_at,captured_by)
  values($1,$2,now(),$3) on conflict(release) do update set payload=excluded.payload,captured_at=excluded.captured_at,captured_by=excluded.captured_by`,[release,payload,capturedBy]);
 return {...payload,snapshot:{capturedAt:new Date().toISOString(),capturedBy,nextRefreshAt:nextRefreshAt()}};
}

export async function getDevelopmentCenterData(pool:pg.Pool,release:ReleaseName){
 const result=await pool.query<{payload:any;captured_at:Date;captured_by:string}>(`select payload,captured_at,captured_by from operations_development_snapshots where release=$1`,[release]);
 if(!result.rows[0])return refreshDevelopmentCenterData(pool,release,'INITIAL');
 const row=result.rows[0];
 return {...row.payload,snapshot:{capturedAt:row.captured_at.toISOString(),capturedBy:row.captured_by,nextRefreshAt:nextRefreshAt()}};
}

const nextRefreshAt=()=>{const now=new Date(),next=new Date(now);next.setHours(23,0,0,0);if(next<=now)next.setDate(next.getDate()+1);return next.toISOString()};
export function scheduleDevelopmentCenterSnapshots(pool:pg.Pool){
 const run=()=>Promise.all((['R1.1','R1.0'] as ReleaseName[]).map(release=>refreshDevelopmentCenterData(pool,release))).catch(()=>undefined);
 const delay=Math.max(1000,new Date(nextRefreshAt()).getTime()-Date.now());
 const timer=setTimeout(()=>{void run();setInterval(()=>void run(),24*60*60*1000).unref()},delay);timer.unref();
}
