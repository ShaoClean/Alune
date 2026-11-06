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
    await wait(
      wc,
      `(()=>{const e=(${button(label)})?.closest('.ant-select');if(!e||e.classList.contains('ant-select-disabled'))return false;e.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));return true})()`,
    );
    await click(textButton(value, '.ant-select-item-option'));
  };
  const text = (label) => 'document.body.innerText.includes(' + JSON.stringify(label) + ')';
  return { visible, element, button, textButton, click, input, select, text };
};
