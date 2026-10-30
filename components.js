/**
 * 仿 fsrs-card-app 的元件（原生 JS 版）：
 * - 下拉選單：取代瀏覽器原生 <select>，選單浮在頁面上，支援鍵盤
 * - 折疊區塊：<section class="acc"> + .acc-head / .acc-body
 */

function enhanceSelect(sel) {
  if (sel.dataset.enhanced) return;
  sel.dataset.enhanced = '1';
  sel.style.display = 'none';

  const wrap = document.createElement('div');
  wrap.className = 'sb';
  wrap.innerHTML = `<button type="button" class="sb-btn" role="combobox" aria-haspopup="listbox" aria-expanded="false"><span class="sb-label"></span></button>
    <span class="sb-chev">${icon('chevron-down', 18)}</span>`;
  sel.insertAdjacentElement('afterend', wrap);
  const btn = wrap.querySelector('.sb-btn');
  const label = wrap.querySelector('.sb-label');

  let menu = null, active = -1;
  const opts = () => [...sel.options];
  const paint = () => { label.textContent = sel.selectedOptions[0]?.textContent || ''; };
  new MutationObserver(paint).observe(sel, { childList: true, subtree: true, attributes: true });
  sel.addEventListener('change', paint);
  paint();

  function close() {
    if (!menu) return;
    menu.remove(); menu = null;
    wrap.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', away, true);
    document.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', close);
  }
  function away(e) { if (!wrap.contains(e.target) && !menu?.contains(e.target)) close(); }
  // 選單自己的捲動（選項太多時）不算「頁面捲動」，否則一打開就被關掉
  function onScroll(e) { if (menu && e.target instanceof Node && menu.contains(e.target)) return; close(); }

  function choose(i) {
    const o = opts()[i];
    if (!o || o.disabled) return;
    const changed = sel.selectedIndex !== i;
    sel.selectedIndex = i;
    paint();
    close();
    btn.focus();
    if (changed) sel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function mark(scroll = true) {
    menu.querySelectorAll('li').forEach((li, i) => {
      li.dataset.active = i === active ? 'true' : 'false';
      if (scroll && i === active) li.scrollIntoView({ block: 'nearest' });
    });
  }

  function open() {
    const list = opts();
    if (!list.length) return;
    menu = document.createElement('ul');
    menu.className = 'sb-menu';
    menu.setAttribute('role', 'listbox');
    menu.innerHTML = list.map((o, i) => `<li role="option" data-i="${i}" aria-selected="${o.selected}"${o.disabled ? ' aria-disabled="true"' : ''}>
        <span>${o.textContent.replace(/</g, '&lt;')}</span>${o.selected ? icon('check', 16) : ''}</li>`).join('');
    document.body.appendChild(menu);

    const r = btn.getBoundingClientRect();
    const below = innerHeight - r.bottom - 12, above = r.top - 12;
    const flip = below < 160 && above > below;
    const max = Math.max(120, Math.min(288, flip ? above : below));
    Object.assign(menu.style, {
      left: r.left + 'px', minWidth: r.width + 'px', maxHeight: max + 'px',
      ...(flip ? { bottom: innerHeight - r.top + 4 + 'px' } : { top: r.bottom + 4 + 'px' }),
    });
    active = Math.max(0, sel.selectedIndex);
    mark();
    wrap.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    menu.addEventListener('pointermove', (e) => {
      const li = e.target.closest('li');
      if (li) { active = +li.dataset.i; mark(false); }
    });
    menu.addEventListener('click', (e) => {
      const li = e.target.closest('li');
      if (li) choose(+li.dataset.i);
    });
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
  }

  btn.addEventListener('click', () => (menu ? close() : open()));
  btn.addEventListener('keydown', (e) => {
    if (!menu) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); }
      return;
    }
    const n = opts().length;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % n; mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + n) % n; mark(); }
    else if (e.key === 'Home') { e.preventDefault(); active = 0; mark(); }
    else if (e.key === 'End') { e.preventDefault(); active = n - 1; mark(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape' || e.key === 'Tab') close();
  });
}

function initAccordions(root = document) {
  root.querySelectorAll('button.acc-head').forEach((h) => {
    if (h.dataset.bound) return;
    h.dataset.bound = '1';
    h.setAttribute('aria-expanded', h.parentElement.classList.contains('open'));
    h.addEventListener('click', () => {
      const acc = h.parentElement;
      acc.classList.toggle('open');
      h.setAttribute('aria-expanded', acc.classList.contains('open'));
    });
  });
}

document.querySelectorAll('select').forEach(enhanceSelect);
initAccordions();
