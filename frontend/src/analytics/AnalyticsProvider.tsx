'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { installAnalyticsLifecycle, track } from './client';

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  useEffect(() => installAnalyticsLifecycle(), []);
  useEffect(() => {
    track('global_page_viewed', { properties: { load_result: 'success' } });
  }, [pathname]);

  return children;
}
