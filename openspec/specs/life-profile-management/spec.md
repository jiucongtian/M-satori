# life-profile-management Specification

## Purpose
TBD - created by archiving change implement-r1-backend. Update Purpose after archive.
## Requirements
### Requirement: Current self-profile and immutable revisions
系统 SHALL 通过 `GET /api/v1/me/life-profile` 返回本人当前档案摘要，通过 `GET /api/v1/me/life-profile/revisions` 分页返回历史，并通过 `GET /api/v1/me/life-profile/revisions/{revisionId}` 返回指定所有者 revision；revision 一经创建不得覆盖更新。

#### Scenario: User reads profile history
- **WHEN** 用户查询档案 revision 列表
- **THEN** 系统返回当前和历史版本、状态、确认时间及关联内容摘要，且旧版本保持可追溯

### Requirement: Profile preview calculation
系统 SHALL 通过要求 `Idempotency-Key` 的 `POST /api/v1/me/life-profile/revisions/preview` 校验出生输入，解析标准地点/时区，执行版本化历法、真太阳时和四柱计算，并创建有期限的 `CALCULATED` revision。

#### Scenario: Valid birth input is previewed
- **WHEN** 用户提交合法公历或农历、时间精度和标准 locationId
- **THEN** 系统返回 revisionId、inputFingerprint、标准化输入、计算摘要、不确定性、差异提示和四张关系卡牌预览

#### Scenario: Input cannot be calculated
- **WHEN** 日期、精度字段组合、地点或时区无法解析
- **THEN** 系统返回 API v1 对应稳定错误码且不创建可确认 revision

#### Scenario: Preview command is retried
- **WHEN** 用户以相同幂等键和输入重试 preview
- **THEN** 系统返回同一 revision 和计算结果

### Requirement: Confirm and activate a preview revision
系统 SHALL 通过要求 `Idempotency-Key` 的 `POST /api/v1/me/life-profile/revisions/{revisionId}/confirm` 校验 revision 所有权、状态、期限和 inputFingerprint，只允许确认一次，并原子切换当前 Active revision。

#### Scenario: User confirms a valid preview
- **WHEN** CALCULATED revision 未过期且 fingerprint 匹配
- **THEN** 系统将其标为 ACTIVE、旧版本标为 SUPERSEDED，并保存确认事实和版本快照

#### Scenario: Confirmation payload differs from preview
- **WHEN** inputFingerprint 不匹配或 revision 已过期
- **THEN** 系统返回 `PROFILE_FINGERPRINT_MISMATCH` 或 `PROFILE_REVISION_EXPIRED` 且不切换当前版本

### Requirement: Four relationship cards
系统 SHALL 将年、月、日、时柱分别映射为时空关系、事业关系、家庭关系、自我关系，并随 preview/confirmed revision 返回稳定排序、用户可见标题、卡牌/知识/映射版本；不得用年月日时作为 UI 标题。

#### Scenario: Confirmed revision returns cards
- **WHEN** 用户查询 ACTIVE revision
- **THEN** 系统返回恰好四张固定维度卡牌和生成依据版本，时间未知时按规则标记不确定性

### Requirement: Historical content remains bound
系统 SHALL 让每份 DailyInsight 或后续内容继续引用生成时的 profile/card revision；新 revision 激活不得改写历史内容。

#### Scenario: Profile is changed after content exists
- **WHEN** 用户确认新 revision
- **THEN** 后续内容使用新版本，既有内容仍解析到原 revision 并可判断是否基于当前档案
