# life-profile-library Specification

## Purpose
TBD - created by archiving change implement-r1-backend. Update Purpose after archive.
## Requirements
### Requirement: User-owned profile library
系统 SHALL 通过 `/api/v1/me/life-profiles` 分页列出和创建当前用户拥有的本人及他人档案，并保证一个用户仅有一个 `SELF` 档案。

#### Scenario: User creates another-person profile
- **WHEN** 用户提交合法显示名称、关系类型和出生资料
- **THEN** 系统创建归属于该用户的 `OTHER` 档案并返回当前 revision 状态

#### Scenario: User attempts a second self profile
- **WHEN** 用户尝试创建第二个 `SELF` 档案
- **THEN** 系统返回冲突错误且不新增档案

### Requirement: Profile revisions and safe updates
系统 SHALL 通过 `/api/v1/me/life-profiles/{profileId}` 查询、更新和删除用户拥有的档案；关键出生资料 MUST 复用 preview/confirm revision 语义，删除前 MUST 返回或校验影响信息。

#### Scenario: Owner updates another-person profile
- **WHEN** 所有者修改档案显示信息和出生资料
- **THEN** 系统更新可变元数据、为关键资料创建新 revision 并保留历史引用

#### Scenario: Non-owner addresses a profile
- **WHEN** 用户请求不属于自己的 `profileId`
- **THEN** 系统返回不支持资源枚举的 not-found 响应且不泄露档案存在性

### Requirement: Profile groups
系统 SHALL 通过 `/api/v1/me/life-profile-groups` 支持当前用户创建、重命名、排序和删除档案分组，并允许其档案加入或移出一个分组。

#### Scenario: Group with profiles is deleted
- **WHEN** 用户删除包含档案的分组
- **THEN** 系统保留档案、清空其 group 关联并以单一事务完成变更

### Requirement: Deletion impact protection
系统 SHALL 阻止静默删除仍被当前任务或内容引用的档案，并对允许删除的他人档案执行逻辑删除和后续清理任务。

#### Scenario: Profile is used by an active generation
- **WHEN** 用户确认删除正在被每日内容生成引用的档案
- **THEN** 系统返回明确阻塞影响且不产生部分删除
