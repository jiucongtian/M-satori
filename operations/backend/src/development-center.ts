export const developmentCenterData={
  source:{mode:'PARTIAL',updatedAt:'2026-09-05T12:00:00+08:00',message:'部署信息来自测试环境；GitHub App、Actions 测试报告与功能映射尚待接入，缺失指标不作推算。'},
  releases:['R1.1','R1.0'],
  release:{name:'R1.1',stage:'测试中',environment:'测试环境',tag:'尚未封版',branch:'release/r1.1',startedAt:'2026-08-18 09:16',taggedAt:null,duration:'进行中'},
  components:[
    {name:'初见前端',path:'frontend',sha:'待接入',additions:null,deletions:null,commits:null,testRate:null,deployment:'待核验'},
    {name:'初见后端',path:'backend',sha:'待接入',additions:null,deletions:null,commits:null,testRate:null,deployment:'待核验'},
    {name:'运营前端',path:'operations/frontend',sha:'待接入',additions:null,deletions:null,commits:null,testRate:null,deployment:'待核验'},
    {name:'运营后端',path:'operations/backend',sha:'待接入',additions:null,deletions:null,commits:null,testRate:null,deployment:'待核验'}
  ],
  lifecycle:[['分支创建','2026/8/18 09:16','事实'],['首次部署','待接入','缺失'],['回归测试','进行中','事实'],['Tag','尚未封版','事实'],['正式发布','尚未发布','事实']],
  features:[
    {name:'商品中心审批与版本管理',page:'ADMIN-PRODUCT-01',status:'已部署',frontend:'商品配置与校验',backend:'/api/products/*',tests:'待关联',issues:'待关联'},
    {name:'运营数据分析',page:'ADMIN-DATA-01~06',status:'已部署',frontend:'六类数据视图',backend:'/api/analytics/*',tests:'待关联',issues:'待关联'},
    {name:'人工权益赠送闭环',page:'ADMIN-BENEFIT-01',status:'待验证',frontend:'赠送申请与记录',backend:'/api/manual-grants/*',tests:'待关联',issues:'#127 以外待关联'},
    {name:'研发数据中心',page:'ADMIN-DEV-01~07',status:'开发中',frontend:'七个研发治理视图',backend:'/api/development-center',tests:'建设中',issues:'#127'}
  ],
  timeline:[['分支创建','2026-08-18','可靠事实'],['首个 Release 独有提交','待 GitHub 回补','不可得'],['首次测试部署','待部署回执接入','不可得'],['回归开始','测试中','当前状态'],['最终 Tag','尚未封版','未发生']],
  code:{hours:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],files:[],exclusions:['依赖目录','构建产物','锁文件','生成代码','图片与二进制文件']},
  quality:{cases:null,functionCoverage:null,executionRate:null,codeCoverage:null,passRate:null,flaky:[],gate:'测试报告尚未接入，不能判断发布门禁'},
  issues:{total:null,p0:null,p1:null,pendingVerification:null,reopened:null,escaped:null,groups:[],message:'GitHub Issue 标签与 Release 映射尚未接入。'},
  health:[
    {source:'测试环境部署回执',status:'可用',freshness:'当前请求',detail:'环境与 Release 来自服务端配置'},
    {source:'GitHub App',status:'待接入',freshness:'—',detail:'Commit、PR、Tag、Issue 暂不可计算'},
    {source:'GitHub Actions',status:'待接入',freshness:'—',detail:'测试执行与覆盖率暂不可计算'},
    {source:'功能映射',status:'部分可用',freshness:'人工维护',detail:'已有四项首版功能，证据链待补齐'},
    {source:'AI 发布摘要',status:'暂停',freshness:'—',detail:'证据不足时不生成确定性结论'}
  ]
};
