// Run inside the TEST operations API container. Never run against production.
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import pg from 'pg';
if (process.env.OPERATIONS_ANALYTICS_ENV !== 'test') throw new Error('Test environment required');
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL});
const token = await new SignJWT({name:'商品入口测试',bootstrap:true,roles:['SUPER_ADMIN']})
  .setProtectedHeader({alg:'HS256'}).setSubject('product-display-test').setAudience('fresh-operations')
  .setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(process.env.OPERATIONS_JWT_SECRET));
async function api(path, method='GET', body) {
  const r=await fetch(`http://127.0.0.1:3210/api${path}`,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await r.json();if(!r.ok)throw new Error(`${method} ${path}: ${r.status} ${result.code}`);return result.data;
}
let id;
const draft={displayName:'展示入口自动验证（停用）',description:'仅测试后台发布与入口配置，不提供用户购买',amountMinor:100,validityDays:30,offeringStatus:'INACTIVE',entitlementSpec:{CARD_READING:1},displayChannels:['SHORTAGE']};
async function publish(value){await api(`/products/${id}/draft`,'PUT',value);const request=await api(`/products/${id}/submit`,'POST',{reason:'测试展示入口变更'});await api(`/action-requests/${request.id}/approve`,'POST',{note:'测试环境自动验证'});return request;}
async function product(){return (await api('/products')).find(p=>p.id===id);}
try {
  id=(await api('/products','POST',{...draft,code:`display-check-${Date.now()}`,serviceType:'CARD_READING',offeringKind:'SINGLE'})).id;
  await pool.query("update offering_versions set purchase_limit=$2 where offering_id=$1",[id,{lifetime:1,audience:'TEST_ONLY'}]);
  await publish(draft);
  let p=await product();assert.equal(p.version_status,'PUBLISHED');assert.equal(p.offering_status,'INACTIVE');assert.deepEqual(p.purchase_limit,{lifetime:1,audience:'TEST_ONLY',displayChannels:['SHORTAGE']});const original=p.version_id;
  const changed={...draft,displayChannels:['STORE','SHORTAGE']};
  await api(`/products/${id}/draft`,'PUT',changed);
  p=await product();assert.deepEqual(p.purchase_limit.displayChannels,['SHORTAGE']);assert.deepEqual(p.draft_payload.displayChannels,['STORE','SHORTAGE']);
  const request=await publish(changed);assert(request.payload.changes.some(c=>c.startsWith('展示入口：')));
  p=await product();assert.deepEqual(p.purchase_limit,{lifetime:1,audience:'TEST_ONLY',displayChannels:['STORE','SHORTAGE']});assert.notEqual(p.version_id,original);
  const previous=(await pool.query('select purchase_limit from offering_versions where id=$1',[original])).rows[0];assert.deepEqual(previous.purchase_limit.displayChannels,['SHORTAGE']);
  const legacy={...draft};delete legacy.displayChannels;await publish(legacy);assert.deepEqual((await product()).purchase_limit.displayChannels,['STORE','SHORTAGE']);
  await publish({...draft,displayChannels:[]});assert.deepEqual((await product()).purchase_limit.displayChannels,[]);
  console.log(JSON.stringify({result:'PASS',checks:['草稿与当前入口隔离','审核变更说明','发布入口持久化','限购字段保留','历史版本不变','旧草稿兼容','可关闭列表入口'],testProductId:id}));
} finally {
  if(id)await publish({...draft,offeringStatus:'ARCHIVED',displayChannels:[]});
  await pool.end();
}
