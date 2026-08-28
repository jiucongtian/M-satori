"use client";

export type AppTab = "今日" | "问事" | "关系" | "成长" | "我的";

const tabs: Array<{ label: AppTab; icon: string }> = [
  { label: "今日", icon: "◉" },
  { label: "问事", icon: "◇" },
  { label: "关系", icon: "∞" },
  { label: "成长", icon: "❧" },
  { label: "我的", icon: "○" },
];

export function AppBottomNav({ active, onNavigate }: { active: AppTab; onNavigate: (tab: AppTab) => void }) {
  return <nav className="app-bottom-nav" aria-label="主导航">
    {tabs.map(({ label, icon }) => <button type="button" key={label} className={active === label ? "active" : ""} onClick={() => onNavigate(label)}>
      <i>{icon}</i><span>{label}</span>
    </button>)}
  </nav>;
}
