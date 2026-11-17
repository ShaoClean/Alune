// A log window has its own Agent connection. Check what it renders against a
// marker written by the desktop host, and clear the view without losing history.
const assert = require('node:assert/strict');
module.exports = async ({ contents, client, wait, marker }) => {
  const { select } = require('./candidate-ui-driver.cjs')(contents, wait);
  const click = (selector) =>
    wait(
      contents,
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled||!e.getClientRects().length)return false;e.click();return true;})()`,
    );
  const queued = marker + '-queued';
  const has = (s) =>
    `[...document.querySelectorAll('.log-line__message')].some(e=>e.textContent===${JSON.stringify(s)})`;
  const reload = async () => {
    const loaded = new Promise((resolve) => contents.once('did-finish-load', resolve));
    contents.reload();
    await loaded;
    await wait(contents, "document.querySelector('.log-viewer__status--live')");
  };
  await select('按来源筛选', 'web');
  await wait(
    contents,
    "document.querySelectorAll('.log-line').length>0&&[...document.querySelectorAll('.log-line__source')].every(e=>e.textContent==='web')",
  );
  await click('.log-line__toggle:not(:disabled)');
  await wait(
    contents,
    "document.querySelector('.log-line__details')?.textContent.includes('candidate-renderer-report')",
  );
  await click('.log-line__toggle[aria-expanded=true]');
  await wait(contents, "!document.querySelector('.log-line__details')");
  await reload();
  for (let batch = 0; batch < 4; batch++)
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        client.request('desktop.log', {
          level: 'INFO',
          source: 'native',
          message: marker + '-scroll-' + (batch * 12 + i),
        }),
      ),
    );
  await wait(contents, has(marker + '-scroll-47'));
  await contents.executeJavaScript(
    "(()=>{const e=document.querySelector('.log-viewer__viewport');e.scrollTop=0;e.dispatchEvent(new Event('scroll',{bubbles:true}))})()",
  );
  const bottom =
    '[...document.querySelectorAll("button")].find(e=>e.getClientRects().length&&e.textContent.trim().startsWith("回到底部"))';
  await wait(contents, bottom);
  await contents.executeJavaScript('(' + bottom + ').click()');
  await wait(
    contents,
    "(()=>{const e=document.querySelector('.log-viewer__viewport');return e.scrollHeight-e.clientHeight-e.scrollTop<2})()",
  );
  await click('[aria-label="暂停"]');
  await wait(contents, "document.querySelector('.log-viewer__status--paused')");
  await client.request('desktop.log', { level: 'WARN', source: 'native', message: queued });
  await wait(
    contents,
    "document.querySelector('.log-viewer__status--paused')?.textContent.includes('待显示')",
  );
  assert.equal(await contents.executeJavaScript(has(queued)), false);
  await click('[aria-label="继续"]');
  await wait(contents, has(queued));
  await contents.executeJavaScript(
    `(()=>{const e=document.querySelector('input[aria-label="关键字搜索"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(queued)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await wait(contents, "document.querySelectorAll('.log-line').length===1 && " + has(queued));
  await click('.log-level-chip--warn');
  await wait(
    contents,
    "document.querySelector('.log-viewer__empty')?.textContent.includes('没有符合筛选条件')",
  );
  await click('.log-level-chip--warn');
  await wait(contents, has(queued));
  await click('[aria-label="清屏"]');
  await wait(
    contents,
    "document.querySelector('.log-viewer__empty')?.textContent.includes('暂无日志')",
  );
  const loaded = new Promise((resolve) => contents.once('did-finish-load', resolve));
  contents.reload();
  await loaded;
  await wait(contents, has(marker) + ' && ' + has(queued));
  assert.equal(
    await contents.executeJavaScript(
      `[...document.querySelectorAll('.log-line__message')].filter(e=>e.textContent===${JSON.stringify(queued)}).length`,
    ),
    1,
  );
};
