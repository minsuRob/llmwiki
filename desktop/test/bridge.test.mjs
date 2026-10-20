import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const block = (p) => {
  const s = readFileSync(new URL(p, import.meta.url), 'utf8');
  const m = /\/\/ <bridge>\n([\s\S]*?)\/\/ <\/bridge>/.exec(s);
  assert.ok(m, `${p} 에 <bridge> 블록이 없다`);
  return m[1];
};

test('브리지 계약 — 셸 원본과 웹 복사본이 같다', () => {
  assert.equal(block('../../aria-rn/src/features/work/desktop.ts'), block('../src/bridge-types.ts'));
});
