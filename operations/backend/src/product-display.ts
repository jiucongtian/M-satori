import { z } from 'zod';

export const displayChannelsSchema = z.array(z.enum(['STORE', 'SHORTAGE'])).max(2)
  .refine(channels => new Set(channels).size === channels.length, '展示入口不能重复');

export function displayChannelChanges(purchaseLimit: unknown, channels: string[] | undefined, kind: string): string[] {
  if (kind === 'MEMBERSHIP' || channels === undefined) return [];
  const stored = (purchaseLimit as { displayChannels?: unknown } | null)?.displayChannels;
  const current = Array.isArray(stored) ? stored.filter(c => c === 'STORE' || c === 'SHORTAGE') : ['STORE'];
  const describe = (values: string[]) => [...values].sort().map(c => c === 'STORE' ? '普通商城' : '次数不足时补购').join('、') || '不进入商城或补购列表';
  return describe(current) === describe(channels) ? [] : [`展示入口：${describe(current)} → ${describe(channels)}`];
}
