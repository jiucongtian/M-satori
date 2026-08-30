## ADDED Requirements

### Requirement: 核心业务域具有稳定可直达路由
系统 SHALL 为欢迎、登录、协议确认、今日首页、建档、每日指引、每日报告、我的首页、本人档案、智慧种子、报告列表和人物档案库提供固定且可静态导出的 URL。

#### Scenario: 直接打开核心路由
- **WHEN** 用户在新的浏览器标签页直接打开任一核心业务域 URL
- **THEN** 系统 SHALL 渲染对应业务域或进入适用的认证/协议守卫，而不是依赖先访问 `/` 产生的内存 step

#### Scenario: 静态服务器直接访问
- **WHEN** Nginx 收到任一已发布固定业务路由的直接请求
- **THEN** 系统 SHALL 返回该路由的静态页面且状态为 HTTP 200

### Requirement: 连续流程使用域内状态机
系统 SHALL 使用具名状态和显式事件管理建档与每日指引等连续流程，并 MUST NOT 为弹窗、加载态、确认态、失败态或每个表单字段步骤创建独立路由。

#### Scenario: 建档步骤前进和返回
- **WHEN** 用户在 `/profile/create` 内填写、确认、计算或查看初识
- **THEN** URL SHALL 保持在建档业务域，状态机 SHALL 依据合法事件切换具名状态

#### Scenario: 非法流程状态
- **WHEN** 恢复数据包含未知状态、缺少必要前置数据或违反允许的状态转换
- **THEN** 系统 SHALL 清除无效状态并回到该业务域的安全起点，不得执行写命令

### Requirement: 认证与协议守卫行为一致
系统 SHALL 使用单一 Session 状态源处理 refresh、匿名、已登录和必须更新协议四种状态，并 SHALL 对所有受保护路由执行一致守卫。

#### Scenario: 匿名访问公开首页
- **WHEN** 未登录用户打开 `/`
- **THEN** 系统 SHALL 立即显示可交互欢迎页且 SHALL NOT 等待 Session Refresh 完成

#### Scenario: 匿名访问受保护路由
- **WHEN** Session 恢复确认用户未登录且用户打开受保护路由
- **THEN** 系统 SHALL 使用 replace 导航到 `/login` 并携带经过白名单校验的站内返回目标

#### Scenario: 已登录访问登录页
- **WHEN** Session 恢复确认用户已登录且当前页面为 `/login`
- **THEN** 系统 SHALL 使用 replace 导航到安全返回目标或 `/home`

#### Scenario: 受保护请求要求更新协议
- **WHEN** 任意受保护 API 返回 `CONSENT_REQUIRED`
- **THEN** 系统 SHALL 导航到 `/consent`，保留经过白名单校验的当前站内目标，并在确认成功后恢复

#### Scenario: 拒绝不安全返回目标
- **WHEN** `next` 指向绝对 URL、协议 URL、双斜线路径或未知业务域
- **THEN** 系统 SHALL 忽略该值并使用预定义的安全默认路由

### Requirement: URL 与临时状态不得泄露敏感数据
系统 MUST NOT 将手机号、验证码、Access Token、Refresh Token、出生日期、出生时间或完整私人问题文本写入路径、查询参数、浏览器历史、分析事件或日志。

#### Scenario: 保存建档草稿
- **WHEN** 系统为刷新恢复临时保存未提交的建档数据
- **THEN** 数据 SHALL 仅保存在当前标签页的版本化 `sessionStorage` 中，并包含过期时间

#### Scenario: 清理敏感草稿
- **WHEN** 用户确认档案、登出、草稿过期或草稿结构校验失败
- **THEN** 系统 SHALL 删除对应临时数据且 SHALL NOT 尝试恢复

### Requirement: 刷新与深链接恢复以后端事实为准
系统 SHALL 在刷新或直接打开资源页面时通过 URL 中的非敏感资源标识查询后端事实，并 SHALL 优先恢复已有 revision、generation task、report 或 account 状态。

#### Scenario: 刷新已生成的每日报告
- **WHEN** 已登录用户刷新 `/daily/report?date=YYYY-MM-DD`
- **THEN** 系统 SHALL 查询该日期的报告并恢复展示，不要求先经过 `/daily` 创建流程

#### Scenario: 恢复生成中的任务
- **WHEN** 用户离开每日指引生成流程后重新进入且后端已有进行中的 task
- **THEN** 系统 SHALL 查询并继续观察现有 task，MUST NOT 自动创建新任务或重复预留智慧种子

#### Scenario: 无效或无权资源
- **WHEN** 资源标识格式无效、资源不存在或不属于当前用户
- **THEN** 系统 SHALL 显示不泄露资源存在性的域级错误态，并提供返回该业务域首页的操作

### Requirement: 浏览器历史与应用返回语义可预测
系统 SHALL 使用客户端路由完成核心业务页导航，并 SHALL 区分用户主动进入、守卫重定向和不可重放流程完成三类历史语义。

#### Scenario: 用户主动进入业务页
- **WHEN** 用户从 `/home` 点击进入 `/daily`
- **THEN** 系统 SHALL 使用 push 创建历史记录，浏览器返回 SHALL 回到 `/home`

#### Scenario: 登录或协议完成
- **WHEN** 用户完成登录或协议确认
- **THEN** 系统 SHALL 使用 replace 进入目标页，浏览器返回 SHALL NOT 回到已完成的登录或协议提交状态

#### Scenario: 直接打开详情后点击返回
- **WHEN** 用户直接打开详情 URL 且不存在可信站内来源
- **THEN** 页面返回操作 SHALL 进入该业务域的预定义默认页，而不是跳出到不确定外部页面

### Requirement: 业务域代码和样式按需加载
系统 SHALL 将 auth、home、profile、daily 和 my 实现放入独立业务域模块，并 MUST NOT 由根布局或公开首页静态导入所有受保护业务域代码和样式。

#### Scenario: 公开首页资源隔离
- **WHEN** 构建正式静态产物并分析 `/` 的初始资源清单
- **THEN** 清单 SHALL NOT 包含 profile、daily 或 my 的页面业务 chunk，且 SHALL NOT 包含完整 Noto CJK WebFont 请求

#### Scenario: 进入业务域后加载代码
- **WHEN** 用户首次进入 `/daily`
- **THEN** 浏览器 SHALL 按需加载 daily 业务域资源，且后续域内状态切换 SHALL NOT 触发整页刷新

### Requirement: 性能预算受自动化守卫
系统 SHALL 对静态构建产物执行可重复的体积检查，并将超出预算视为发布阻塞。

#### Scenario: 首页预算
- **WHEN** 生成正式静态构建
- **THEN** `/` 的现代浏览器 gzip JS+CSS 总量 SHALL 不高于 263 KB，目标 SHALL 至少比该基线降低 25%

#### Scenario: 业务域预算
- **WHEN** 生成任一首批业务域的首路由 chunk
- **THEN** 该业务域新增 gzip JavaScript SHALL 不高于 100 KB，或由评审记录明确批准例外

### Requirement: 路由迁移保持现有业务语义
系统 SHALL 保持现有 `/api/v1` 契约、Session Cookie、内存 Access Token、Idempotency-Key、协议接受、档案版本、生成任务和智慧种子账务语义不变。

#### Scenario: 组件重挂载不重复执行命令
- **WHEN** React Strict Mode、快速双击、刷新或前进后退导致组件重复挂载或事件重复触发
- **THEN** preview、confirm、claim、create 和 generate 命令 SHALL 至多形成一个有效业务结果

#### Scenario: 读页面不产生写副作用
- **WHEN** 用户直接打开、刷新或返回首页、报告、档案或种子页面
- **THEN** 系统 SHALL 只执行恢复所需的读请求，不得自动发放、扣费、确认档案或创建生成任务

### Requirement: 分阶段迁移可验证且可回滚
系统 SHALL 以业务域为单位迁移，每个阶段 MUST 包含独立提交、自动化测试、构建验证、测试环境验收和明确回滚点。

#### Scenario: 迁移一个业务域
- **WHEN** 新业务域路由达到验收标准
- **THEN** 系统 SHALL 删除该域在旧 `profileSteps` 中的可达分支，防止两套实现长期分叉

#### Scenario: 测试环境验收失败
- **WHEN** 任一固定路由、核心业务链路、API/Worker 健康或性能预算验证失败
- **THEN** 发布 SHALL 停止或将 `frontend/current` 原子恢复到上一不可变发布目录，不执行数据库降级

### Requirement: 路由状态具备可访问性与可观测性
系统 SHALL 为每个核心路由设置可识别标题、主标题焦点和加载/错误播报，并 SHALL 记录不含敏感数据的规范化路由与守卫结果。

#### Scenario: 客户端路由完成
- **WHEN** 用户通过客户端导航进入新的核心路由
- **THEN** 文档标题 SHALL 更新，键盘焦点 SHALL 移到页面主标题或主内容容器

#### Scenario: 记录导航诊断信息
- **WHEN** 路由守卫、资源恢复或导航失败
- **THEN** 系统 SHALL 记录 route ID、来源类别、结果和错误码，且 MUST NOT 记录手机号、出生资料、Token 或报告正文
