import type {Page} from '@playwright/test';

const users=[{id:'11111111-1111-4111-8111-111111111111',phone_masked:'131****1314',status:'ACTIVE',seed_balance:18}];
const products=[
 {id:'1',code:'SP-READ-001',offering_kind:'SINGLE',offering_status:'ACTIVE',version_status:'PUBLISHED',user_visible:true,published_at:'2026-09-01T00:00:00Z',version:3,display_name:'抽卡问事',description:'围绕一个具体问题完成解读。',amount_minor:690,validity_days:30,entitlement_spec:{READING:1}},
 {id:'2',code:'PK-READ-010',offering_kind:'PACKAGE',offering_status:'ACTIVE',version_status:'PUBLISHED',user_visible:true,published_at:'2026-09-01T00:00:00Z',version:2,display_name:'抽卡问事 · 10 次包',description:'十次问事服务包。',amount_minor:5990,validity_days:180,entitlement_spec:{READING:10}},
 {id:'3',code:'MB-QINGHE',offering_kind:'MEMBERSHIP',offering_status:'DRAFT',version_status:'DRAFT',user_visible:false,published_at:null,version:4,display_name:'清和计划',description:'月度陪伴计划。',amount_minor:19900,validity_days:30,entitlement_spec:{DAILY:15,READING:5}}
];
const identity={user_id:users[0].id,phone_masked:'131****1314',nickname:'林知夏'};
const orders=[{id:'o1',order_number:'FR202609020018',owner_user_id:users[0].id,user:identity,status:'PAID',amount_minor:19900,display_name:'清和计划',fulfillment_status:'EXCEPTION'}];
const analytics={scope:{environment:'test',release:'R1.1',days:7,refresh_seconds:60,app_version:'R1.1',commit_sha:'56a7998abc'},summary:{events:18426,pv:4826,anonymous_uv:1842,sessions:2317,active_users:726,bound_events:15200,binding_rate:82.5,last_received_at:'2026-09-03T06:32:00.000Z',average_delay_seconds:1.8},trend:[{day:'09-01',pv:562,uv:231,sessions:286},{day:'09-02',pv:684,uv:278,sessions:342},{day:'09-03',pv:741,uv:304,sessions:381}],pageRows:[{page_code:'R1.0 · HOME-01',route:'/home',pv:1842,uv:826,errors:3},{page_code:'R1.1 · READ-01',route:'/readings',pv:1106,uv:608,errors:7}],errorRows:[{reason_code:'RESOURCE_LOAD_FAILED',page_code:'R1.0 · HOME-01',count:3,affected_uv:2,request_id:null}],eventCounts:{daily_home_viewed:1842,daily_guidance_cta_clicked:986,daily_guidance_started:812,daily_report_viewed:704,reading_home_viewed:1106,reading_card_count_selected:629,reading_draw_completed:581,reading_report_viewed:508,commerce_catalog_viewed:868,commerce_offering_viewed:542,commerce_purchase_clicked:218,commerce_quote_created:196,commerce_order_created:173,commerce_payment_started:121,commerce_payment_result_recorded:86,onboarding_entry_viewed:1286,auth_otp_requested:1038,auth_login_result_recorded:892,profile_information_confirmed:706,onboarding_gift_claimed:642}};
const analyticsSegments={products:[{name:'清和计划',kind:'MEMBERSHIP',views:318,purchase_clicks:126,orders:112,paid:68}],devices:[{category:'mobile',viewport_group:'regular',uv:1426,events:15000,errors:31},{category:'mobile',viewport_group:'wide',uv:96,events:842,errors:15}],releases:[{app_version:'R1.1',commit_sha:'56a7998abc',sessions:2317,events:18426,errors:46}],business:{registered_users:126,orders:173,paid_orders:86,revenue_minor:684200}};
const analyticsDiagnostic={summary:{count:3,affected_uv:2,first_seen_at:'2026-09-03T05:30:00.000Z',last_seen_at:'2026-09-03T06:32:00.000Z'},groups:[{reason_code:'RESOURCE_LOAD_FAILED',page_code:'R1.0 · HOME-01',route:'/home',count:3,affected_uv:2,last_seen_at:'2026-09-03T06:32:00.000Z'}],samples:[{event_name:'api_request_failed',result:'failed',reason_code:'RESOURCE_LOAD_FAILED',page_code:'R1.0 · HOME-01',route:'/home',source_page:'/auth',object_type:null,object_id:null,app_version:'R1.1',commit_sha:'56a7998abc',request_id:'01a055dd-c0e7-741d-86a0-b5e3f1846a5a',received_at:'2026-09-03T06:32:00.000Z',api_template:'/api/daily/reports',http_method:'GET',http_status:'503',action_code:'LOAD_DAILY',device_category:'mobile',operating_system:'HarmonyOS',browser:'WeChat',viewport_group:'wide'}]};

export async function installApiFixture(page:Page){
 await page.addInitScript(()=>localStorage.setItem('fresh_operations_token','test-token'));
 await page.route('**/operations-api/**',async route=>{
  const path=new URL(route.request().url()).pathname.replace('/operations-api','');
  const url=new URL(route.request().url());
  const query=url.searchParams.get('q')||'';
  const data=path.startsWith('/users')?(query&&!query.includes('131')?[]:users):path==='/products'?products:path==='/orders'?orders:path==='/dashboard'?{new_users:1,pending_orders:0,open_cases:1,critical_cases:1}:path==='/analytics/overview'?analytics:path==='/analytics/segments'?analyticsSegments:path==='/analytics/error-diagnostics'?analyticsDiagnostic:path==='/me'?{phone:'18108291023',nickname:'测试管理员',roles:[{code:'SUPER_ADMIN',name:'超级管理员'}]}:path==='/meta/operation-roles'?[{code:'SUPER_ADMIN',name:'超级管理员'}]:path==='/accounts'?[]:path==='/benefits'?[]:path==='/audit'?[]:path==='/action-requests'?[]:[];
  const body=path==='/orders'?{data,pagination:{page:1,pageSize:20,total:1,totalPages:1}}:{data};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
}
