import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source=await readFile(new URL('../src/server.ts',import.meta.url),'utf8');
const route=source.slice(source.indexOf("app.get('/api/users',"),source.indexOf("app.get('/api/users/:id',"));
async function request(allowed:boolean, data:any[], q='') {
  let handler:any;
  let queried=false;
  const headers:Record<string,string>={};
  runInNewContext(ts.transpile(route),{
    app:{get:(_path:string,fn:any)=>{handler=fn}},
    userRoles:[],requireRoles:()=>()=>allowed,
    rows:async(sql:string,args:string[])=>{queried=true;assert.match(sql,/i\.phone_ciphertext/);assert.equal(args[0],q);return data},
    phoneHash:()=> 'hashed-query',decrypt:(value:string)=>value==='bad'?'':value||'',
  });
  const result=await handler({query:{q}},{header:(key:string,value:string)=>{headers[key]=value}});
  return {result,queried,headers};
}
test('用户列表返回完整手机号，移除密文并禁止缓存',async()=>{
  const {result,headers}=await request(true,[{id:'user-1',phone_masked:'138****0000',phone_ciphertext:'+8613800000000',display_name_ciphertext:'测试用户'}],'13800000000');
  assert.equal(result.data[0].phone,'13800000000');
  assert.equal(result.data[0].nickname,'测试用户');
  assert.equal('phone_ciphertext' in result.data[0],false);
  assert.equal('display_name_ciphertext' in result.data[0],false);
  assert.equal(headers['cache-control'],'no-store, private');
});
test('未绑定号码和解密失败均不伪造完整手机号',async()=>{
  const {result}=await request(true,[{phone_ciphertext:null},{phone_ciphertext:'bad'}]);
  assert.equal(result.data[0].phone,null);
  assert.equal(result.data[0].phone_status,'UNBOUND');
  assert.equal(result.data[1].phone,null);
  assert.equal(result.data[1].phone_status,'BOUND');
});
test('无用户查看权限时不查询手机号',async()=>{
  const {result,queried}=await request(false,[]);
  assert.equal(result,undefined);
  assert.equal(queried,false);
});
