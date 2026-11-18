// Tiny DOM helpers and shared components.

/**
 * h('div.card#id', {onclick, class, style, ...attrs}, ...children)
 * Children may be strings, nodes, arrays, null/false (skipped).
 */
export function h(sel, attrs, ...children) {
  if (attrs === null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) {
    children.unshift(attrs);
    attrs = {};
  }
  const m = sel.match(/^([a-z0-9-]+)?((?:[.#][^.#]+)*)$/i);
  const tag = (m && m[1]) || 'div';
  const el = document.createElement(tag);
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][^.#]+/g)) {
      if (part[0] === '.') el.classList.add(part.slice(1));
      else el.id = part.slice(1);
    }
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Segmented control. options: [{value,label}] */
export function segmented({ options, value, onChange, label, small = false }) {
  const wrap = h('div.segmented' + (small ? '.small' : ''), { role: 'radiogroup', 'aria-label': label });
  for (const o of options) {
    const b = h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(o.value === value),
      class: o.value === value ? 'on' : '',
      onclick: () => {
        for (const x of wrap.children) { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); }
        b.classList.add('on'); b.setAttribute('aria-checked', 'true');
        onChange(o.value);
      },
    }, o.label);
    wrap.append(b);
  }
  return wrap;
}

/** Numeric stepper. */
export function stepper({ value, min = -Infinity, max = Infinity, step = 1, onChange, label, format = (v) => v }) {
  let v = value;
  const out = h('output.stepper-val', { 'aria-live': 'polite' }, format(v));
  const set = (nv) => { v = Math.min(max, Math.max(min, nv)); out.textContent = format(v); onChange(v); };
  return h('div.stepper', { role: 'group', 'aria-label': label },
    h('button.btn.icon', { type: 'button', 'aria-label': `Decrease ${label}`, onclick: () => set(v - step) }, '−'),
    out,
    h('button.btn.icon', { type: 'button', 'aria-label': `Increase ${label}`, onclick: () => set(v + step) }, '+'),
  );
}

let toastTimer;
export function toast(msg, { action, onAction, ms = 3500 } = {}) {
  const root = document.getElementById('toast');
  clear(root);
  root.append(h('span', msg));
  if (action) root.append(h('button.btn.small', { onclick: () => { root.classList.remove('show'); onAction(); } }, action));
  root.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => root.classList.remove('show'), ms);
}

/** Bottom sheet. content: Node or (close) => Node. Returns close(). */
export function sheet(title, content, { onClose } = {}) {
  const prevFocus = document.activeElement;
  const backdrop = h('div.sheet-backdrop');
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
    prevFocus?.focus?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const body = typeof content === 'function' ? content(close) : content;
  const panel = h('div.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.sheet-head',
      h('h2', title),
      h('button.btn.icon.ghost', { type: 'button', 'aria-label': 'Close', onclick: close }, '✕')),
    h('div.sheet-body', body));
  backdrop.append(panel);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);
  document.getElementById('sheets').append(backdrop);
  requestAnimationFrame(() => panel.querySelector('input,select,button:not(.ghost)')?.focus?.({ preventScroll: true }));
  return close;
}

export function confirmSheet(title, message, { ok = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const close = sheet(title, (close) => h('div.stack',
      h('p', message),
      h('div.row.end',
        h('button.btn', { type: 'button', onclick: () => { done = true; close(); resolve(false); } }, 'Cancel'),
        h('button.btn' + (danger ? '.danger' : '.primary'), { type: 'button', onclick: () => { done = true; close(); resolve(true); } }, ok))),
    { onClose: () => { if (!done) resolve(false); } });
    void close;
  });
}

/** Labelled field wrapper. */
export function field(label, input, hint) {
  const id = input.id || 'f-' + Math.random().toString(36).slice(2, 9);
  input.id = id;
  return h('div.field', h('label', { for: id }, label), input, hint ? h('small.hint', hint) : null);
}

export function numInput({ value, decimal = true, placeholder = '', onInput, label, cls = '' }) {
  return h('input' + cls, {
    type: 'text', inputmode: decimal ? 'decimal' : 'numeric', pattern: decimal ? undefined : '[0-9]*',
    value: value ?? '', placeholder, autocomplete: 'off', 'aria-label': label,
    oninput: (e) => onInput?.(e.target.value),
  });
}

export function empty(title, text, action) {
  return h('div.empty', h('div.empty-icon', { 'aria-hidden': 'true' }, '◌'), h('h3', title), text ? h('p.muted', text) : null, action || null);
}

export function bar(value, max, { cls = '', label } = {}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return h('div.bar' + cls, { role: 'progressbar', 'aria-valuenow': String(Math.round(value)), 'aria-valuemin': '0', 'aria-valuemax': String(Math.round(max)), 'aria-label': label },
    h('div.bar-fill', { style: { width: pct + '%' } }));
}
