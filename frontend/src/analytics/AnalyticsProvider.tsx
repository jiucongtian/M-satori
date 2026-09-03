'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { installAnalyticsLifecycle, track } from './client';
import { installBusinessInteractionTracking } from './businessEvents';

const pageEvents: Array<{ matches: (pathname: string) => boolean; eventName: string; pageCode: string }> = [
  { matches: (path) => path === '/', eventName: 'onboarding_entry_viewed', pageCode: 'R1.0 · AUTH-02' },
  { matches: (path) => path === '/login', eventName: 'auth_login_page_viewed', pageCode: 'R1.0 · AUTH-03' },
  { matches: (path) => path === '/consent', eventName: 'consent_page_viewed', pageCode: 'R1.0 · AUTH-04' },
  { matches: (path) => path.startsWith('/profile/create'), eventName: 'profile_creation_started', pageCode: 'R1.0 · PROFILE-02—07' },
  { matches: (path) => path === '/home' || path === '/daily', eventName: 'daily_home_viewed', pageCode: 'R1.0 · HOME-01' },
  { matches: (path) => path.startsWith('/daily/report'), eventName: 'daily_report_viewed', pageCode: 'R1.0 · DAILY-03' },
  { matches: (path) => path === '/readings', eventName: 'reading_home_viewed', pageCode: 'R1.1 · READ-01' },
  { matches: (path) => path.startsWith('/readings/new'), eventName: 'reading_question_page_viewed', pageCode: 'R1.1 · READ-02' },
  { matches: (path) => path.startsWith('/readings/spread'), eventName: 'reading_card_count_viewed', pageCode: 'R1.1 · READ-05' },
  { matches: (path) => path.startsWith('/readings/shuffle'), eventName: 'reading_shuffle_page_viewed', pageCode: 'R1.1 · READ-10' },
  { matches: (path) => path.startsWith('/readings/draw'), eventName: 'reading_draw_page_viewed', pageCode: 'R1.1 · READ-11' },
  { matches: (path) => path.startsWith('/readings/reveal'), eventName: 'reading_reveal_page_viewed', pageCode: 'R1.1 · READ-12' },
  { matches: (path) => path.startsWith('/readings/generating'), eventName: 'reading_generation_viewed', pageCode: 'R1.1 · READ-13' },
  { matches: (path) => path.startsWith('/readings/report'), eventName: 'reading_report_viewed', pageCode: 'R1.1 · READ-15' },
  { matches: (path) => path.startsWith('/readings/failure'), eventName: 'reading_failure_viewed', pageCode: 'R1.1 · READ-14' },
  { matches: (path) => path.startsWith('/readings/history'), eventName: 'reading_history_viewed', pageCode: 'R1.1 · READ-19' },
  { matches: (path) => path === '/shop', eventName: 'commerce_catalog_viewed', pageCode: 'R1.1 · SHOP-01' },
  { matches: (path) => path.startsWith('/shop/detail'), eventName: 'commerce_offering_viewed', pageCode: 'R1.1 · SHOP-02' },
  { matches: (path) => path === '/checkout', eventName: 'commerce_checkout_viewed', pageCode: 'R1.1 · ORDER-01' },
  { matches: (path) => path.startsWith('/payment/result'), eventName: 'commerce_payment_result_viewed', pageCode: 'R1.1 · ORDER-03' },
  { matches: (path) => path.startsWith('/my/membership'), eventName: 'membership_plan_viewed', pageCode: 'R1.1 · MEMBER-01' },
  { matches: (path) => path.startsWith('/my/benefits'), eventName: 'entitlement_list_viewed', pageCode: 'R1.1 · BENEFIT-01' },
  { matches: (path) => path.startsWith('/my/orders'), eventName: 'order_list_viewed', pageCode: 'R1.1 · ORDER-01' },
  { matches: (path) => path === '/my', eventName: 'my_home_viewed', pageCode: 'R1.1 · MY-01' },
];

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    const removeLifecycle = installAnalyticsLifecycle();
    const removeInteractions = installBusinessInteractionTracking();
    return () => { removeInteractions(); removeLifecycle(); };
  }, []);
  useEffect(() => {
    const domainEvent = pageEvents.find(({ matches }) => matches(pathname));
    const offeringId = pathname.startsWith('/shop/detail') ? new URLSearchParams(window.location.search).get('offeringId') : null;
    track('global_page_viewed', { page_code: domainEvent?.pageCode, properties: { load_result: 'success' } });
    if (domainEvent) track(domainEvent.eventName, { page_code: domainEvent.pageCode, object_type: offeringId ? 'offering' : undefined, object_id: offeringId ?? undefined, properties: { load_result: 'success' } });
  }, [pathname]);

  return children;
}
