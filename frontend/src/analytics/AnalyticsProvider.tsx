'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { installAnalyticsLifecycle, track } from './client';

const pageEvents: Array<{ matches: (pathname: string) => boolean; eventName: string }> = [
  { matches: (path) => path.startsWith('/profile/create'), eventName: 'profile_creation_started' },
  { matches: (path) => path === '/home' || path === '/daily', eventName: 'daily_home_viewed' },
  { matches: (path) => path.startsWith('/daily/report'), eventName: 'daily_report_viewed' },
  { matches: (path) => path === '/readings', eventName: 'reading_home_viewed' },
  { matches: (path) => path.startsWith('/readings/history'), eventName: 'reading_history_viewed' },
  { matches: (path) => path === '/shop', eventName: 'commerce_catalog_viewed' },
  { matches: (path) => path.startsWith('/shop/detail'), eventName: 'commerce_offering_viewed' },
  { matches: (path) => path.startsWith('/my/membership'), eventName: 'membership_plan_viewed' },
  { matches: (path) => path.startsWith('/my/benefits'), eventName: 'entitlement_list_viewed' },
  { matches: (path) => path.startsWith('/my/orders'), eventName: 'order_list_viewed' },
  { matches: (path) => path === '/my', eventName: 'my_home_viewed' },
];

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  useEffect(() => installAnalyticsLifecycle(), []);
  useEffect(() => {
    track('global_page_viewed', { properties: { load_result: 'success' } });
    const domainEvent = pageEvents.find(({ matches }) => matches(pathname));
    if (domainEvent) track(domainEvent.eventName, { properties: { load_result: 'success' } });
  }, [pathname]);

  return children;
}
