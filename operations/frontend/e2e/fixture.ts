import type {Page} from '@playwright/test';

const users=[{id:'11111111-1111-4111-8111-111111111111',phone_masked:'131****1314',status:'ACTIVE',seed_balance:18}];
const products=[
 {id:'1',code:'SP-READ-001',offering_kind:'SINGLE',status:'PUBLISHED',version:3,display_name:'抽卡问事',description:'围绕一个具体问题完成解读。',amount_minor:690,validity_days:30,entitlement_spec:{READING:1}},
 {id:'2',code:'PK-READ-010',offering_kind:'PACKAGE',status:'PUBLISHED',version:2,display_name:'抽卡问事 · 10 次包',description:'十次问事服务包。',amount_minor:5990,validity_days:180,entitlement_spec:{READING:10}},
 {id:'3',code:'MB-QINGHE',offering_kind:'MEMBERSHIP',status:'DRAFT',version:4,display_name:'清和计划',description:'月度陪伴计划。',amount_minor:19900,validity_days:30,entitlement_spec:{DAILY:15,READING:5}}
];
const identity={user_id:users[0].id,phone_masked:'131****1314',nickname:'林知夏'};
const orders=[{id:'o1',order_number:'FR202609020018',owner_user_id:users[0].id,user:identity,status:'PAID',amount_minor:19900,display_name:'清和计划',fulfillment_status:'EXCEPTION'}];
const analytics={scope:{environment:'test',release:'R1.1',days:7},summary:{events:18426,pv:4826,anonymous_uv:1842,sessions:2317,active_users:726,last_received_at:'2026-09-03T06:32:00.000Z',average_delay_seconds:1.8},trend:[{day:'09-01',pv:562,uv:231,sessions:286},{day:'09-02',pv:684,uv:278,sessions:342},{day:'09-03',pv:741,uv:304,sessions:381}],pageRows:[{page_code:'R1.0 · HOME-01',route:'/home',pv:1842,uv:826,errors:3},{page_code:'R1.1 · READ-01',route:'/readings',pv:1106,uv:608,errors:7}],errorRows:[{reason_code:'RESOURCE_LOAD_FAILED',page_code:'R1.0 · HOME-01',count:3,affected_uv:2,request_id:null}],eventCounts:{daily_home_viewed:1842,daily_guidance_cta_clicked:986,daily_guidance_started:812,daily_report_viewed:704,reading_home_viewed:1106,reading_card_count_selected:629,reading_draw_completed:581,reading_report_viewed:508,commerce_catalog_viewed:868,commerce_offering_viewed:542,commerce_purchase_clicked:218,commerce_quote_created:196,commerce_order_created:173,commerce_payment_started:121,commerce_payment_result_recorded:86,onboarding_entry_viewed:1286,auth_otp_requested:1038,auth_login_result_recorded:892,profile_information_confirmed:706,onboarding_gift_claimed:642}};

export async function installApiFixture(page:Page){
 await page.addInitScript(()=>localStorage.setItem('fresh_operations_token','test-token'));
 await page.route('**/operations-api/**',async route=>{
  const path=new URL(route.request().url()).pathname.replace('/operations-api','');
  const url=new URL(route.request().url());
  const query=url.searchParams.get('q')||'';
  const data=path.startsWith('/users')?(query&&!query.includes('131')?[]:users):path==='/products'?products:path==='/orders'?orders:path==='/dashboard'?{new_users:1,pending_orders:0,open_cases:1,critical_cases:1}:path==='/analytics/overview'?analytics:path==='/me'?{phone:'18108291023',nickname:'测试管理员',roles:[{code:'SUPER_ADMIN',name:'超级管理员'}]}:path==='/meta/operation-roles'?[{code:'SUPER_ADMIN',name:'超级管理员'}]:path==='/accounts'?[]:path==='/benefits'?[]:path==='/audit'?[]:path==='/action-requests'?[]:[];
  const body=path==='/orders'?{data,pagination:{page:1,pageSize:20,total:1,totalPages:1}}:{data};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
}
