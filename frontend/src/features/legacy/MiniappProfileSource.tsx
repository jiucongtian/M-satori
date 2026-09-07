"use client";

import type { MiniappProfileSource } from "@/src/api/client";
import "./miniapp-profile-source.css";

export function MiniappSourceDetails({ source, expanded = false }: { source: MiniappProfileSource; expanded?: boolean }) {
  const birth = source.birthInput;
  const date = `${birth.date.year}年${birth.date.isLeapMonth ? "闰" : ""}${birth.date.month}月${birth.date.day}日`;
  const pillars = [["年柱", source.pillars.year], ["月柱", source.pillars.month], ["日柱", source.pillars.day], ["时柱", source.pillars.hour]];
  return <details className="miniapp-source-details" open={expanded || undefined}>
    <summary>查看原小程序资料</summary>
    <div className="miniapp-source-content">
      <p className="miniapp-source-origin">来自身心游卡牌微信小程序</p>
      <dl>
        <div><dt>原档案名称</dt><dd>{source.profileName}</dd></div>
        <div><dt>出生日期</dt><dd>{date} · {birth.calendarType === "LUNAR" ? "农历" : "公历"}</dd></div>
        <div><dt>原记录时间</dt><dd>{source.originalLocalTime || "未填写"}{source.timeUncertain ? " · 时间不确定" : " · 时辰记录"}</dd></div>
        <div><dt>性别</dt><dd>{birth.calculationGender === "MALE" ? "男" : "女"}</dd></div>
      </dl>
      <h2>原四柱卡牌</h2>
      <div className="miniapp-original-pillars">{pillars.map(([label, value]) => <div key={label}><small>{label}</small><strong>{value || "未记录"}</strong></div>)}</div>
      <p className="miniapp-source-explanation">这里保留小程序保存的四柱结果。Satori 卡牌在上方单独显示，以后修改资料也可继续回看这些原记录。</p>
      {source.description && <section className="miniapp-source-description"><h2>原备注</h2><p>{source.description}</p></section>}
    </div>
  </details>;
}
