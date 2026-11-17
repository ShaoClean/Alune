const assert = require('node:assert/strict');
module.exports = async ({ contents, logs, wait, marker }) => {
  const error = marker + '-error',
    rejection = marker + '-rejection';
  await contents.executeJavaScript(`(()=>{
    const error=new Error(${JSON.stringify(error)});
    const event=new ErrorEvent('error',{error,message:error.message,filename:'candidate://controlled-error',lineno:1});
    window.dispatchEvent(event);window.dispatchEvent(event);
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection',{promise:Promise.resolve(),reason:new Error(${JSON.stringify(rejection)})}));
  })()`);
  await wait(
    logs,
    `[${JSON.stringify(error)},${JSON.stringify(rejection)}].every(s=>[...document.querySelectorAll('.log-line')].some(e=>e.querySelector('.log-line__message')?.textContent.includes(s)))`,
  );
  const rows = await logs.executeJavaScript(
    `JSON.stringify([...document.querySelectorAll('.log-line')].filter(e=>[${JSON.stringify(error)},${JSON.stringify(rejection)}].some(s=>e.querySelector('.log-line__message')?.textContent.includes(s))).map(e=>({message:e.querySelector('.log-line__message').textContent,source:e.querySelector('.log-line__source').textContent,level:e.querySelector('.log-line__level').textContent})))`,
  );
  const parsed = JSON.parse(rows);
  assert.equal(parsed.length, 2);
  assert.ok(parsed.every((r) => r.source === 'web' && r.level === 'ERROR'));
  assert.equal(parsed.filter((r) => r.message.includes(error)).length, 1);
  assert.equal(parsed.filter((r) => r.message.includes(rejection)).length, 1);
};
