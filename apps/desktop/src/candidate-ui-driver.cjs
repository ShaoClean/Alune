// Select only visible controls in the active page or modal. React can replace
// a control between tasks: check and dispatch once within the same evaluation.
module.exports = function driver(wc, wait) {
  const visible = "e=>e.getClientRects().length && !e.closest('[inert]')";
  const element = (q) =>
    '[...document.querySelectorAll(' + JSON.stringify(q) + ')].find(' + visible + ')';
  const button = (label) => element('[aria-label="' + label + '"]');
  const textButton = (label, scope = 'button') =>
    `[...document.querySelectorAll(${JSON.stringify(scope)})].filter(${visible}).find(e=>e.textContent.replace(/\\s/g,'')===${JSON.stringify(label.replace(/\s/g, ''))})`;
  const click = (expr) =>
    wait(
      wc,
      `(()=>{const e=(${expr});if(!e||e.disabled||e.getAttribute('aria-disabled')==='true'||e.getAttribute('aria-busy')==='true'||e.classList.contains('ant-btn-loading'))return false;e.click();return true;})()`,
    );
  const input = async (expr, value) => {
    await wait(
      wc,
      `(()=>{const e=(${expr});if(!e||e.disabled||e.readOnly)return false;e.focus();Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));if(e.type==='date')e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`,
      'editable UI control: ' + expr,
    );
    // The DOM property changes before React commits a controlled date draft.
    // Wait for its rendered value before editing another field or paging.
    await wait(
      wc,
      `(()=>{const e=(${expr});return !!e&&(e.type!=='date'||e.getAttribute('value')===${JSON.stringify(String(value))})})()`,
    );
    return true;
  };
  const select = async (label, value) => {
    const control = `(${button(label)})?.closest('.ant-select')?.querySelector('[role=combobox]')`;
    // Enter opens (rather than toggles) a closed combobox. Wait for its actual
    // expanded state and for selection to close it before another interaction.
    await wait(wc, `(()=>{const e=(${control});if(!e||e.disabled)return false;if(e.getAttribute('aria-expanded')==='true')return true;e.focus();e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));return false})()`);
    await click(textButton(value, '.ant-select-item-option'));
    await wait(wc, `(${control})?.getAttribute('aria-expanded')==='false'`);
  };
  // A visible modal can precede its portal's global Escape subscription. Give
  // React effects a rendered frame, activate the actual window, and send a real
  // key pair rather than dispatching an event into an animating/stale modal.
  const pressKey = async (expr, keyCode) => {
    const eventKey = keyCode === 'Return' ? 'Enter' : keyCode;
    const window = require('electron').BrowserWindow.fromWebContents(wc);
    await require('./smoke-window.cjs')(window);
    await wait(wc, `(()=>{const e=(${expr});if(!e)return false;e.focus();return document.activeElement===e;})()`);
    await wc.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    // Closing portals remain on rc-dialog's global Escape stack until their
    // exit motion finishes. Wait for finite dialog motions, including the
    // previous dialog, so Escape is delivered to the visible modal's owner.
    await wait(wc, "![...document.querySelectorAll('.a-dlg')].some(root=>root.getAnimations({subtree:true}).some(a=>a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity))");
    // Portal initial-focus/motion callbacks can run during those frames. Rebind
    // and focus the actual current control, then verify the native key's target.
    await wait(wc, `(()=>{const e=(${expr});if(!e)return false;e.focus();if(document.activeElement!==e)return false;window.__candidateNativeKeyTarget=e;return true})()`);
    await wc.executeJavaScript(`(()=>{window.__candidateNativeKey=false;window.__candidateNativeKeyListener=e=>{if(e.key===${JSON.stringify(eventKey)}&&e.target===window.__candidateNativeKeyTarget)window.__candidateNativeKey=true};window.addEventListener('keydown',window.__candidateNativeKeyListener,true)})()`);
    try {
      wc.sendInputEvent({ type: 'keyDown', keyCode });
      await wait(wc, 'window.__candidateNativeKey===true');
    } finally {
      wc.sendInputEvent({ type: 'keyUp', keyCode });
      await wc.executeJavaScript("window.removeEventListener('keydown',window.__candidateNativeKeyListener,true);delete window.__candidateNativeKeyListener;delete window.__candidateNativeKey;delete window.__candidateNativeKeyTarget");
    }
  };
  const text = (label) => 'document.body.innerText.includes(' + JSON.stringify(label) + ')';
  return { visible, element, button, textButton, click, input, select, pressKey, text };
};
