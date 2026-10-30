/**
 * 購物車試算：結帳頁沒有原價，這裡用原價算實際折數，並比較各活動。
 * 依賴 dashboard.js 的 $、esc、money、fmtDisc。
 */

const LV_RATE = { 0: 1, 1: 2, 2: 3, 3: 5, 4: 6, 5: 8, 6: 10, 7: 12 };
let cartItems = [];

const num = (id) => Math.max(0, parseFloat($(id).value) || 0);

async function loadCart() {
  const d = await chrome.storage.local.get(['bwCartItems', 'bwMemberLv', 'bwSettings']);
  cartItems = d.bwCartItems || [];
  const sel = $('c-lv');
  if (!sel.options.length) {
    sel.innerHTML = '<option value="-1">不計點數</option>' +
      Object.entries(LV_RATE).map(([lv, r]) => `<option value="${lv}">LV.${lv}（${r}%）</option>`).join('');
    const rules = d.bwSettings?.cartRules;
    if (rules) { ['t1', 'b1', 't2', 'r2'].forEach((k) => { if (rules[k]) $('c-' + k).value = rules[k]; }); }
    sel.value = rules?.lv ?? (d.bwMemberLv ?? -1);
  }
  renderCart();
}

function saveCart() { return chrome.storage.local.set({ bwCartItems: cartItems }); }

async function saveRules() {
  const { bwSettings = {} } = await chrome.storage.local.get('bwSettings');
  await chrome.storage.local.set({
    bwSettings: {
      ...bwSettings,
      cartRules: { t1: $('c-t1').value, b1: $('c-b1').value, t2: $('c-t2').value, r2: $('c-r2').value, lv: $('c-lv').value },
    },
  });
}

function renderCart() {
  const list = $('cart-list');
  if (!cartItems.length) {
    list.innerHTML = '<div class="empty"><i data-icon="shopping-cart" data-size="32"></i><br>清單是空的<br>按<b>讀取購物車</b>，或在商品頁按<b>加入購物車試算</b></div>';
    hydrateIcons(list);
  } else {
    list.innerHTML = cartItems.map((it, i) => `
      <div class="cart-item${it.selected ? '' : ' off'}" data-i="${i}">
        <label class="check"><input type="checkbox" class="sel"${it.selected ? ' checked' : ''}></label>
        <div class="t"><div>${esc(it.title || '（未命名）')}</div><div class="meta">${esc(it.category || '')}${it.origUnknown ? ' · 原價讀取失敗，暫以售價計' : ''}</div></div>
        <div class="pr"><s>${money(it.orig)}</s><b>${money(it.sale)}</b><div class="meta">${fmtDisc(it.orig ? it.sale / it.orig : null)}</div></div>
        <button class="del" title="移除">${icon('x')}</button>
      </div>`).join('');
  }
  calc();
}

function calc() {
  const sel = cartItems.filter((it) => it.selected);
  const orig = sel.reduce((s, it) => s + it.orig, 0);
  const sale = sel.reduce((s, it) => s + it.sale, 0);
  $('c-count').textContent = sel.length;
  $('c-orig').textContent = money(orig);
  const saved = orig - sale;
  $('c-saved').textContent = saved > 0 ? '-' + saved.toLocaleString() + ' 元' : '—';
  $('c-sale').textContent = money(sale);
  $('c-disc').textContent = orig ? fmtDisc(sale / orig) : '—';

  const actual = parseFloat($('c-actual').value);
  $('c-actual-disc').textContent = orig && actual >= 0 ? fmtDisc(actual / orig) : '—';

  const t1 = num('c-t1'), b1 = num('c-b1'), t2 = num('c-t2'), r2 = num('c-r2');
  const coupon = num('c-coupon'), pointUse = num('c-pointuse');
  const lv = parseInt($('c-lv').value, 10);
  const rate = lv >= 0 ? LV_RATE[lv] : 0;

  // 常見活動（參考）：全館折扣以每本「原價」計算（75 折就是原價的 75%），且不會比目前售價更貴；滿額活動再套在折後合計上
  const disc = (r) => sel.reduce((s, it) => s + Math.min(it.sale, Math.floor(it.orig * r)), 0);
  const thr = (base, t, b) => base - Math.floor(base / t) * b;
  const scen = [
    { name: '現價', pay: sale },
    { name: '全館 75 折', pay: disc(0.75) },
    { name: '全館 88 折', pay: disc(0.88) },
    { name: '滿 1500 送 150', pay: thr(sale, 1500, 150) },
    { name: '75 折 + 滿 1500 送 150', pay: thr(disc(0.75), 1500, 150) },
    { name: '88 折 + 滿 1500 送 150', pay: thr(disc(0.88), 1500, 150) },
    { name: '滿 1500 再 88 折', pay: sale >= 1500 ? Math.floor(sale * 0.88) : sale },
    ...(t1 > 0 && b1 > 0 ? [{ name: `滿 ${t1} 送 ${b1}（自訂）`, pay: thr(sale, t1, b1) }] : []),
    ...(t2 > 0 && r2 > 0 && r2 < 10 ? [{ name: `滿 ${t2} 再 ${r2} 折（自訂）`, pay: sale >= t2 ? Math.floor((sale * r2) / 10) : sale }] : []),
  ].map((s) => {
    const after = Math.max(0, s.pay - coupon - pointUse);
    const pts = Math.floor((after * rate) / 100);
    return { ...s, after, pts, real: after - pts };
  });
  const best = Math.min(...scen.map((s) => s.real));
  const allSame = scen.every((s) => s.real === best);

  $('cart-scen').innerHTML = sel.length ? scen.map((s) => `
    <tr class="${!allSame && s.real === best ? 'best' : ''}">
      <td>${s.name}${!allSame && s.real === best ? '<span class="tag-best">最划算</span>' : ''}</td>
      <td class="num">${money(s.after)}</td>
      <td class="num">${s.pts ? s.pts + ' 點' : '—'}</td>
      <td class="num">${money(s.real)}</td>
      <td class="num">${fmtDisc(orig ? s.after / orig : null)}</td>
      <td class="num">${fmtDisc(orig ? s.real / orig : null)}</td>
    </tr>`).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--muted)">請勾選要試算的書</td></tr>';

  const hints = [];
  [[t1 > 0 && b1 > 0 ? t1 : 0, `滿 ${t1} 送 ${b1}`], [t2 > 0 && r2 > 0 ? t2 : 0, `滿 ${t2} 再 ${r2} 折`]].forEach(([t, name]) => {
    if (sel.length && t > 0 && sale < t) hints.push(`距離「${name}」還差 ${money(t - sale)}`);
  });
  hints.push('活動為範例規則，僅供參考，以官網當期為準。');
  $('cart-hint').innerHTML = hints.map(esc).join('<br>');
}

/* ── 事件 ── */
$('cart-list').addEventListener('change', async (e) => {
  const row = e.target.closest('.cart-item');
  if (!row || !e.target.classList.contains('sel')) return;
  cartItems[+row.dataset.i].selected = e.target.checked;
  await saveCart();
  renderCart();
});
$('cart-list').addEventListener('click', async (e) => {
  const row = e.target.closest('.cart-item');
  if (!row || !e.target.closest('.del')) return;
  cartItems.splice(+row.dataset.i, 1);
  await saveCart();
  renderCart();
});

['c-coupon', 'c-pointuse', 'c-actual'].forEach((id) => $(id).addEventListener('input', calc));
['c-t1', 'c-b1', 'c-t2', 'c-r2', 'c-lv'].forEach((id) => {
  const el = $(id);
  if (!el) return;
  el.addEventListener('input', () => { calc(); saveRules(); });
  el.addEventListener('change', () => { calc(); saveRules(); });
});

$('cart-read').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'READ_CART' }));
$('cart-add-manual').addEventListener('click', () => {
  const f = $('cart-manual');
  f.style.display = f.style.display === 'none' ? '' : 'none';
});
$('cart-manual').addEventListener('submit', async (e) => {
  e.preventDefault();
  const orig = parseInt($('cm-orig').value, 10), sale = parseInt($('cm-sale').value, 10);
  if (isNaN(orig) || isNaN(sale)) return;
  cartItems.push({
    productId: 'manual-' + Date.now(), title: $('cm-title').value.trim(), category: '',
    orig, sale, source: 'manual', selected: true,
  });
  e.target.reset();
  await saveCart();
  renderCart();
});
$('cart-reset').addEventListener('click', async () => {
  ['c-coupon', 'c-pointuse'].forEach((id) => { $(id).value = 0; });
  ['c-t1', 'c-b1', 'c-t2', 'c-r2', 'c-actual'].forEach((id) => { $(id).value = ''; });
  const { bwMemberLv } = await chrome.storage.local.get('bwMemberLv');
  $('c-lv').value = bwMemberLv ?? -1;
  $('c-lv').dispatchEvent(new Event('change', { bubbles: true }));
  await saveRules();
  calc();
});
$('cart-clear').addEventListener('click', async () => {
  if (!cartItems.length || !confirm('清空試算清單？')) return;
  cartItems = [];
  await saveCart();
  renderCart();
});

function renderCartState(s) {
  const el = $('cart-status');
  const btn = $('cart-read');
  btn.disabled = !!s?.running;
  el.className = 'cart-status' + (s?.error ? ' err' : '');
  el.textContent = s?.running ? (s.total ? `讀取中… ${s.done}/${s.total}` : '讀取中…') : (s?.error || '');
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.bwCartItems) { cartItems = changes.bwCartItems.newValue || []; renderCart(); }
  if (changes.bwCartState) renderCartState(changes.bwCartState.newValue);
});

(async () => {
  await loadCart();
  const { bwCartState } = await chrome.storage.local.get('bwCartState');
  renderCartState(bwCartState);
})();
