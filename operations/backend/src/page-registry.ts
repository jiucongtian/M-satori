export const pageCodeByRoute: Readonly<Record<string, string>> = Object.freeze({
  '/': 'R1.0 · AUTH-02',
  '/login': 'R1.0 · AUTH-03',
  '/consent': 'R1.0 · AUTH-04',
  '/home': 'R1.0 · HOME-01',
  '/daily': 'R1.0 · HOME-01',
  '/daily/report': 'R1.0 · DAILY-03',
  '/readings': 'R1.1 · READ-01',
  '/readings/new': 'R1.1 · READ-02',
  '/readings/payment': 'R1.1 · READ-09',
  '/readings/spread': 'R1.1 · READ-05',
  '/readings/shuffle': 'R1.1 · READ-10',
  '/readings/draw': 'R1.1 · READ-11',
  '/readings/reveal': 'R1.1 · READ-12',
  '/readings/generating': 'R1.1 · READ-13',
  '/readings/failure': 'R1.1 · READ-14',
  '/readings/report': 'R1.1 · READ-15',
  '/readings/history': 'R1.1 · READ-19',
  '/shop': 'R1.1 · SHOP-01',
  '/shop/detail': 'R1.1 · SHOP-04',
  '/checkout': 'R1.1 · ORDER-01',
  '/payment/result': 'R1.1 · ORDER-03',
  '/my': 'R1.1 · MY-01',
  '/my/profile': 'R1.0 · MY-02 / R1.1 · MY-02',
  '/my/archive': 'R1.0 · MY-09 / R1.1 · MY-09',
  '/my/membership': 'R1.1 · SHOP-02',
  '/my/benefits': 'R1.1 · SEED-02',
  '/my/orders': 'R1.1 · ORDER-01',
});

export type AnalyticsPageRow = {
  page_code?: string | null;
  route?: string | null;
  pv?: number | string | null;
  uv?: number | string | null;
  errors?: number | string | null;
};

export function registeredPageCode(pageCode?: string | null, route?: string | null): string {
  if (pageCode?.trim()) return pageCode.trim();
  return (route && pageCodeByRoute[route]) || '未登记页面';
}

export function normalizeAnalyticsPageRows(rows: AnalyticsPageRow[]): Array<Required<Pick<AnalyticsPageRow, 'page_code' | 'route'>> & {pv:number;uv:number;errors:number}> {
  const normalized = new Map<string, {page_code:string;route:string;pv:number;uv:number;errors:number}>();
  for (const row of rows) {
    const route = row.route || '—';
    const page_code = registeredPageCode(row.page_code, row.route);
    const key = `${page_code}\u0000${route}`;
    const current = normalized.get(key) || { page_code, route, pv: 0, uv: 0, errors: 0 };
    current.pv += Number(row.pv || 0);
    current.uv += Number(row.uv || 0);
    current.errors += Number(row.errors || 0);
    normalized.set(key, current);
  }
  return [...normalized.values()].sort((a, b) => b.pv - a.pv);
}
