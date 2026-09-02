import assert from 'node:assert/strict';import test from 'node:test';
test('用户界面不得直接暴露内部状态枚举',()=>{const forbidden=['TERMINATED_BY_UPGRADE','PROPERTY_LIMIT','ACTIVE'];assert.equal(forbidden.some(x=>/^[\u4e00-\u9fa5]+$/.test(x)),false)});
