import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayChannelsSchema, displayChannelChanges } from '../src/product-display.js';

test('入口支持单选、多选和关闭列表，拒绝未知入口及重复入口', () => {
  for (const value of [[], ['STORE'], ['SHORTAGE'], ['STORE', 'SHORTAGE']]) assert.deepEqual(displayChannelsSchema.parse(value), value);
  for (const value of [['UNKNOWN'], ['STORE', 'STORE']]) assert.equal(displayChannelsSchema.safeParse(value).success, false);
});
test('审核变更说明准确解释补购与商城切换，旧草稿保留原配置', () => {
  assert.deepEqual(displayChannelChanges({ displayChannels: ['SHORTAGE'], lifetime: 1 }, ['STORE'], 'SINGLE'), ['展示入口：次数不足时补购 → 普通商城']);
  assert.deepEqual(displayChannelChanges({ displayChannels: ['SHORTAGE'] }, undefined, 'SINGLE'), []);
  assert.deepEqual(displayChannelChanges({}, ['STORE'], 'PACKAGE'), []);
  assert.deepEqual(displayChannelChanges({ displayChannels: ['STORE', 'SHORTAGE'] }, ['SHORTAGE', 'STORE'], 'PACKAGE'), []);
  assert.deepEqual(displayChannelChanges({}, [], 'SINGLE'), ['展示入口：普通商城 → 不进入商城或补购列表']);
  assert.deepEqual(displayChannelChanges({}, [], 'MEMBERSHIP'), []);
});
