const PAID = '付款完成';
const MONTH_NAMES = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
const $ = (id) => document.getElementById(id);

let rawOrders = [];
let includeFree = false;
let year = null;              // 目前選的年份，'all' 代表全部
let barChart = null;
const openOrders = new Set(); // 展開的訂單 id
let scopedOrders = [];        // 目前年份範圍內的訂單，供訂單分頁篩選用

Chart.defaults.font.family = "'Inter','Chiron Hei HK','Microsoft JhengHei','PingFang TC',sans-serif";

/* ══ 資料 ══════════════════════════════════════════════════════ */
async function loadData() {
  const d = await chrome.storage.local.get(['bwOrders', 'bwSettings', 'bwLastScan']);
  rawOrders = d.bwOrders || [];
  includeFree = !!d.bwSettings?.includeFree;
  $('include-free').checked = includeFree;
  $('last-scan').textContent = d.bwLastScan ? `上次掃描：${fmtTime(d.bwLastScan)}` : '';
}

function fmtTime(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const money = (n) => '$' + n.toLocaleString();
function fmtDisc(r) {
  if (r === null || !isFinite(r)) return '—';
  return (Math.round(r * 100) / 10).toString().replace(/\.0$/, '') + ' 折';
}

/** 依「納入免費書」設定算出有效訂單：items 過濾、本數、原價總和、訂單折數 */
function effectiveOrders() {
  const out = [];
  for (const o of rawOrders) {
    if (o.status !== PAID) continue;
    if (!includeFree && o.amount === 0) continue;
    const hasItems = Array.isArray(o.items);
    const items = hasItems ? (includeFree ? o.items : o.items.filter((it) => it.price > 0)) : [];
    const listSum = items.reduce((s, it) => s + it.price, 0);
    out.push({
      ...o, hasItems, eItems: items,
      books: items.reduce((s, it) => s + it.qty, 0),
      listSum,
      disc: hasItems && listSum > 0 ? o.amount / listSum : null,
    });
  }
  return out;
}

/** 加總：花費、訂單數、本數、折數（折數只用有明細的訂單） */
function summarize(orders) {
  const withItems = orders.filter((o) => o.disc !== null);
  const paySum = withItems.reduce((s, o) => s + o.amount, 0);
  const listSum = withItems.reduce((s, o) => s + o.listSum, 0);
  return {
    total: orders.reduce((s, o) => s + o.amount, 0),
    count: orders.length,
    books: orders.reduce((s, o) => s + o.books, 0),
    disc: listSum > 0 ? paySum / listSum : null,
  };
}

/* ══ 渲染 ══════════════════════════════════════════════════════ */
function renderAll() {
  const orders = effectiveOrders();
  const years = [...new Set(orders.map((o) => o.year))].sort((a, b) => b - a);
  // 預設顯示今年；今年沒有資料就退到最近有資料的一年
  if (year !== 'all' && !years.includes(year)) year = years.includes(new Date().getFullYear()) ? new Date().getFullYear() : (years[0] ?? 'all');

  const missing = orders.filter((o) => !o.hasItems).length;
  const notice = $('notice');
  notice.style.display = missing ? 'block' : 'none';
  notice.innerHTML = `有 ${missing} 筆訂單缺少明細（舊版資料），本數與折數不含這些訂單。請按<b>掃描全部</b>補抓明細。`;

  $('overview-empty').style.display = years.length ? 'none' : '';
  $('overview-content').style.display = years.length ? '' : 'none';
  $('filter-left').style.display = years.length ? '' : 'none';

  if (years.length) {
    const sel = $('year-sel');
    sel.innerHTML = '<option value="all">全部年份</option>' + years.map((y) => `<option value="${y}">${y} 年</option>`).join('');
    sel.value = year;
    const scoped = year === 'all' ? orders : orders.filter((o) => o.year === year);
    scopedOrders = scoped;
    renderYear(scoped);
    renderChart(scoped, years);
    renderMonths(scoped);
    renderOrders(scoped);
    renderYearly(orders, years);
    syncMinHeight();
  }
  if (typeof renderCart === 'function') renderCart();
}

function renderYear(orders) {
  const s = summarize(orders);
  const pre = year === 'all' ? '' : '年度';
  $('l-total').textContent = pre + '總花費';
  $('l-count').textContent = pre + '訂單數';
  $('l-books').textContent = pre + '本數';
  $('l-disc').textContent = pre + '平均折數';

  // 以「年-月」為單位算月均與最高單月
  const byMonth = new Map();
  orders.forEach((o) => {
    const k = `${o.year}-${o.month}`;
    byMonth.set(k, (byMonth.get(k) || 0) + o.amount);
  });
  const active = [...byMonth.values()].filter((v) => v > 0).length;
  let peakKey = null, peak = 0;
  byMonth.forEach((v, k) => { if (v > peak) { peak = v; peakKey = k; } });
  const [py, pm] = peakKey ? peakKey.split('-') : [];

  $('m-total').textContent = money(s.total);
  $('m-avg').textContent = active ? money(Math.round(s.total / active)) : '—';
  $('m-peak').textContent = peak > 0 ? money(peak) : '—';
  $('m-peak-sub').textContent = peak > 0 ? (year === 'all' ? `（${py}/${pm}）` : `（${pm}月）`) : '';
  $('m-count').textContent = s.count.toLocaleString() + ' 筆';
  $('m-books').textContent = s.books.toLocaleString() + ' 本';
  $('m-disc').textContent = fmtDisc(s.disc);
}

function renderChart(orders, years) {
  let labels, data;
  if (year === 'all') {
    const asc = [...years].sort((a, b) => a - b);
    labels = asc.map((y) => y + ' 年');
    data = asc.map((y) => orders.filter((o) => o.year === y).reduce((s, o) => s + o.amount, 0));
    $('chart-title').textContent = '每年趨勢';
  } else {
    labels = MONTH_NAMES;
    data = Array(12).fill(0);
    orders.forEach((o) => { data[o.month - 1] += o.amount; });
    $('chart-title').textContent = '每月趨勢';
  }
  const colors = data.map((v) => (v > 0 ? '#9a7c67' : '#e6e6e6'));
  const stepSize = year === 'all' ? undefined : 1000;

  // 圖表已存在就原地更新，避免整張重畫、重播動畫
  if (barChart) {
    barChart.data.labels = labels;
    barChart.data.datasets[0].data = data;
    barChart.data.datasets[0].backgroundColor = colors;
    barChart.options.scales.y.ticks.stepSize = stepSize;
    barChart.update();
    return;
  }
  barChart = new Chart($('bar-chart').getContext('2d'), {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 4, borderSkipped: 'bottom' }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' ' + money(c.parsed.y) } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#707070', autoSkip: false, maxRotation: 0 } },
        y: { grid: { color: '#e6e6e6' }, ticks: { color: '#707070', stepSize, callback: (v) => money(v) } },
      },
    },
  });
}

/** 明細區以「月明細」的高度為最小高度（不固定高度，內容更多時仍會長高） */
function syncMinHeight() {
  const body = document.querySelector('.group-body');
  const sm = $('sub-months');
  if (!body || body.offsetParent === null) return;   // 分頁被隱藏時量不準，保留上次的值
  const prev = sm.style.cssText;
  body.style.minHeight = '';
  sm.style.cssText = 'display:block;position:absolute;visibility:hidden;width:' + body.clientWidth + 'px';
  const h = Math.ceil(sm.getBoundingClientRect().height);
  sm.style.cssText = prev;
  body.style.minHeight = h + 'px';
}

// 月明細顯示中時，直接跟著表格實際高度走（視窗縮放、字型載入、列數變動都會更新）
new ResizeObserver(() => {
  const body = document.querySelector('.group-body');
  const h = Math.ceil($('sub-months').getBoundingClientRect().height);
  if (body && h > 0) body.style.minHeight = h + 'px';
}).observe($('sub-months'));

/* ── 明細：月明細／訂單／年度總計 ── */
function renderMonths(orders) {
  const rowHtml = (name, total, count, books, max, y, m) => `<tr${count ? ` data-y="${y}" data-m="${m}" title="查看這個月的訂單"` : ''}>
    <td>${name}</td>
    <td><div class="bar-bg"><div class="bar-fill" style="width:${Math.round((total / max) * 100)}%"></div></div></td>
    <td class="num">${total > 0 ? money(total) : '—'}</td>
    <td class="num">${count || '—'}</td>
    <td class="num">${books || '—'}</td>
  </tr>`;
  if (year === 'all') {
    $('th-month').textContent = '年月';
    const map = new Map();
    orders.forEach((o) => {
      const k = o.year * 100 + o.month;
      const g = map.get(k) || { total: 0, count: 0, books: 0 };
      g.total += o.amount; g.count++; g.books += o.books;
      map.set(k, g);
    });
    const keys = [...map.keys()].sort((a, b) => b - a);
    const max = Math.max(...keys.map((k) => map.get(k).total), 1);
    $('month-tbody').innerHTML = keys.map((k) => {
      const g = map.get(k);
      return rowHtml(`${Math.floor(k / 100)}/${String(k % 100).padStart(2, '0')}`, g.total, g.count, g.books, max, Math.floor(k / 100), k % 100);
    }).join('');
    return;
  }
  $('th-month').textContent = '月份';
  const totals = Array(12).fill(0), counts = Array(12).fill(0), books = Array(12).fill(0);
  orders.forEach((o) => { totals[o.month - 1] += o.amount; counts[o.month - 1]++; books[o.month - 1] += o.books; });
  const max = Math.max(...totals, 1);
  $('month-tbody').innerHTML = MONTH_NAMES.map((name, i) => rowHtml(name, totals[i], counts[i], books[i], max, year, i + 1)).join('');
}

function renderYearly(orders, years) {
  $('yearly-tbody').innerHTML = years.map((y) => {
    const s = summarize(orders.filter((o) => o.year === y));
    return `<tr><td>${y}</td><td class="num">${money(s.total)}</td><td class="num">${s.count} 筆</td><td class="num">${s.books} 本</td><td class="num">${fmtDisc(s.disc)}</td></tr>`;
  }).join('');
}

function renderOrders(orders) {
  const monthSel = $('month-sel3');
  const cur = monthSel.value || 'all';
  monthSel.innerHTML = '<option value="all">全部</option>' + MONTH_NAMES.map((n, i) => `<option value="${i + 1}">${n}</option>`).join('');
  monthSel.value = cur;
  const mo = monthSel.value === 'all' ? null : parseInt(monthSel.value, 10);

  const list = orders
    .filter((o) => !mo || o.month === mo)
    .sort((a, b) => b.year - a.year || b.month - a.month || b.day - a.day || b.orderId.localeCompare(a.orderId));

  if (!list.length) {
    $('orders-list').innerHTML = '<div class="empty"><i data-icon="inbox" data-size="32"></i><br>此期間無訂單</div>';
    hydrateIcons($('orders-list'));
    return;
  }
  $('orders-list').innerHTML = list.map(orderCard).join('');
}

function orderCard(o) {
  const date = `${o.year}/${String(o.month).padStart(2, '0')}/${String(o.day).padStart(2, '0')}`;
  const body = !o.hasItems
    ? '<div class="nodetail">此訂單沒有明細資料，請按<b>掃描全部</b>補抓。</div>'
    : o.eItems.length
      ? o.eItems.map((it) => `<div class="item"><span class="t">${esc(it.title)}</span><span class="cat">${esc(it.category)}</span><span class="p">${money(it.price)} × ${it.qty} 本</span></div>`).join('')
      : '<div class="nodetail">沒有可顯示的項目（免費書已隱藏）。</div>';
  return `<div class="order${openOrders.has(o.orderId) ? ' open' : ''}" data-id="${esc(o.orderId)}">
    <button class="order-head">
      <span class="oid">#${esc(o.orderId)}</span><span class="odate">${date}</span><span class="ogrow"></span>
      <span class="oamt">${money(o.amount)}</span>
      <span class="odisc${o.disc === null ? ' none' : ''}">${fmtDisc(o.disc)}</span>
      <span class="chev">${icon('chevron-down')}</span>
    </button>
    <div class="order-body">${body}</div>
  </div>`;
}

/* ══ 事件 ══════════════════════════════════════════════════════ */
document.querySelectorAll('.tab').forEach((btn) => btn.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.id === 'pane-' + btn.dataset.tab));
  if (btn.dataset.tab === 'overview') syncMinHeight();
}));

$('year-sel').addEventListener('change', (e) => {
  year = e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10);
  renderAll();
});

// 只重畫訂單清單，不動上面的指標與圖表
$('month-sel3').addEventListener('change', () => renderOrders(scopedOrders));

function showSub(name) {
  document.querySelectorAll('.pill[data-sub]').forEach((x) => x.classList.toggle('active', x.dataset.sub === name));
  document.querySelectorAll('.sub').forEach((x) => x.classList.toggle('active', x.id === 'sub-' + name));
  $('month-filter').style.display = name === 'orders' ? '' : 'none';
}

function setMonthFilter(value) {
  const sel = $('month-sel3');
  if (sel.value === value) return;
  sel.value = value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}

// 月明細點某個月 → 切到訂單分頁並固定篩選該月份
$('month-tbody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-m]');
  if (!tr) return;
  const y = parseInt(tr.dataset.y, 10);
  if (year !== y) { year = y; renderAll(); }
  setMonthFilter(tr.dataset.m);
  showSub('orders');
});

// 直接點上方「訂單」分頁 → 顯示全部月份
document.querySelectorAll('.pill[data-sub]').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.sub === 'orders') setMonthFilter('all');
  showSub(b.dataset.sub);
}));

function toggleOrder(e) {
  const head = e.target.closest('.order-head');
  if (!head) return;
  const box = head.parentElement, id = box.dataset.id;
  openOrders.has(id) ? openOrders.delete(id) : openOrders.add(id);
  box.classList.toggle('open');
}
$('orders-list').addEventListener('click', toggleOrder);

$('include-free').addEventListener('change', async (e) => {
  includeFree = e.target.checked;
  const { bwSettings = {} } = await chrome.storage.local.get('bwSettings');
  await chrome.storage.local.set({ bwSettings: { ...bwSettings, includeFree } });
  renderAll();
});

/* ── 掃描 ── */
$('scan-all').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'START_SCAN', mode: 'all' }));
$('scan-new').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'START_SCAN', mode: 'new' }));
$('scan-stop').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'STOP_SCAN' }));

function renderScan(s) {
  const running = !!s?.running;
  $('scan-all').style.display = running ? 'none' : '';
  $('scan-new').style.display = running ? 'none' : '';
  $('scan-stop').style.display = running ? '' : 'none';
  const box = $('scan-box');
  const hasErr = !running && s?.error && s.error !== '已停止';
  box.className = 'scan-box' + (running ? ' on' : hasErr ? ' err' : '');
  if (running) {
    const pct = s.totalPages ? Math.round((s.page / s.totalPages) * 100) : 0;
    $('scan-text').textContent = '掃描中...' + (s.failed ? `（${s.failed} 筆明細抓取失敗）` : '');
    $('scan-pct').textContent = '';
    $('fill').style.width = pct + '%';
  } else if (hasErr) {
    $('scan-text').textContent = s.error;
    $('scan-pct').textContent = '';
    $('fill').style.width = '0';
  }
}

chrome.storage.onChanged.addListener(async (changes) => {
  if (changes.bwScanState) renderScan(changes.bwScanState.newValue);
  if (changes.bwOrders || changes.bwSettings || changes.bwLastScan) { await loadData(); renderAll(); }
});

/* ── 備份 ── */
function backupMsg(text, kind = '') {
  const el = $('backup-msg');
  el.textContent = text;
  el.className = kind;
}
async function guarded(label, fn) {
  const btns = document.querySelectorAll('#pane-backup button');
  btns.forEach((b) => (b.disabled = true));
  backupMsg(label + '…');
  try { await fn(); } catch (e) {
    backupMsg(e.message, 'err');
  } finally { btns.forEach((b) => (b.disabled = false)); }
}

$('file-export').addEventListener('click', () => guarded('匯出中', async () => {
  const blob = new Blob([JSON.stringify(await buildBackup(), null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bw-spending-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  backupMsg('已匯出 JSON', 'ok');
}));
$('file-import').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  guarded('匯入中', async () => {
    const data = JSON.parse(await file.text());
    const n = data?.bwOrders?.length ?? 0;
    if (!confirm(`匯入檔含 ${n} 筆訂單，將覆蓋目前資料，確定匯入？`)) { backupMsg(''); return; }
    await applyBackup(data);
    backupMsg(`已匯入 ${n} 筆訂單`, 'ok');
  });
});

$('clear-btn').addEventListener('click', async () => {
  if (!confirm('確定要清除所有已掃描的訂單資料？（建議先備份）')) return;
  await chrome.storage.local.remove(['bwOrders', 'bwLastScan', 'bwScanState']);
});

/* ══ 啟動 ══════════════════════════════════════════════════════ */
(async () => {
  await loadData();
  renderAll();
  const { bwScanState } = await chrome.storage.local.get('bwScanState');
  renderScan(bwScanState);
})();
