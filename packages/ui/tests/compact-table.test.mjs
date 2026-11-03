import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CompactTable } from '@alune/ui';

const columns = [{ key: 'name', title: '名称', render: (item) => item.name }];
const props = { label: '项目', columns, rowKey: (item) => item.id, rowLabel: (item) => item.id };
test('grouped table keeps row and group semantics, unique selection and excludes empty groups', () => {
  const html = renderToStaticMarkup(
    React.createElement(CompactTable, {
      ...props,
      selectedKey: 'two',
      onSelect() {},
      groups: [
        { key: 'empty', label: '不应出现', items: [] },
        {
          key: 'one',
          label: '主机一',
          items: [
            { id: 'one', name: '同名' },
            { id: 'two', name: '同名' },
          ],
        },
        { key: 'two', label: '主机二', items: [{ id: 'three', name: '第三个' }] },
      ],
    }),
  );
  assert.match(html, /scope="rowgroup" rowSpan="2"/);
  assert.equal((html.match(/scope="row"/g) || []).length, 3);
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1);
  assert.match(html, /aria-label="two" aria-pressed="true"/);
  assert.doesNotMatch(html, /不应出现|rowSpan="0"/);
});
test('empty table spans the grouping column and all data columns', () => {
  const html = renderToStaticMarkup(
    React.createElement(CompactTable, { ...props, groups: [], empty: '没有匹配项' }),
  );
  assert.match(html, /colSpan="2">没有匹配项/);
  assert.doesNotMatch(html, /data-compact-row-button/);
});
