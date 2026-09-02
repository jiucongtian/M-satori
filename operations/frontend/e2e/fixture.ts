import type {Page} from '@playwright/test';

const users=[{id:'11111111-1111-4111-8111-111111111111',phone_masked:'131****1314',status:'ACTIVE',seed_balance:18}];
const products=[
 {id:'1',code:'SP-READ-001',offering_kind:'SINGLE',status:'PUBLISHED',version:3,display_name:'抽卡问事',description:'围绕一个具体问题完成解读。',amount_minor:690,validity_days:30,entitlement_spec:{READING:1}},
 {id:'2',code:'PK-READ-010',offering_kind:'PACKAGE',status:'PUBLISHED',version:2,display_name:'抽卡问事 · 10 次包',description:'十次问事服务包。',amount_minor:5990,validity_days:180,entitlement_spec:{READING:10}},
 {id:'3',code:'MB-QINGHE',offering_kind:'MEMBERSHIP',status:'DRAFT',version:4,display_name:'清和计划',description:'月度陪伴计划。',amount_minor:19900,validity_days:30,entitlement_spec:{DAILY:15,READING:5}}
];
const orders=[{id:'o1',order_number:'FR202609020018',owner_user_id:users[0].id,status:'PAID',amount_minor:19900,display_name:'清和计划',fulfillment_status:'EXCEPTION'}];

export async function installApiFixture(page:Page){
 await page.addInitScript(()=>localStorage.setItem('fresh_operations_token','test-token'));
 await page.route('**/operations-api/**',async route=>{
  const path=new URL(route.request().url()).pathname.replace('/operations-api','');
  const url=new URL(route.request().url());
  const query=url.searchParams.get('q')||'';
  const data=path.startsWith('/users')?(query&&!query.includes('131')?[]:users):path==='/products'?products:path==='/orders'?orders:path==='/dashboard'?{new_users:1,pending_orders:0,open_cases:1,critical_cases:1}:path==='/benefits'?[]:path==='/audit'?[]:path==='/action-requests'?[]:[];
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data})});
 });
}
