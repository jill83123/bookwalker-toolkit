/**
 * BookWalker 消費統計 v2 - Background Service Worker
 * 以 offscreen document 做 fetch + DOMParser，這裡負責流程、節流與儲存。
 */

const PAID = '付款完成';
const DETAIL_DELAY_MS = 300;   // 明細請求間隔
const PAGE_DELAY_MS   = 200;   // 列表頁請求間隔

let running = false;
let cancelled = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument();
  if (has) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['DOM_PARSER'],
    justification: '解析 BookWalker 訂單列表與明細的 HTML',
  });
}

function ask(msg) {
  return chrome.runtime.sendMessage({ target: 'offscreen', ...msg });
}

function setState(patch) {
  return chrome.storage.local.get('bwScanState').then(({ bwScanState }) =>
    chrome.storage.local.set({ bwScanState: { ...(bwScanState || {}), ...patch } }));
}

async function fetchDetail(orderId) {
  for (let i = 0; i < 2; i++) {
    const r = await ask({ type: 'FETCH_DETAIL', orderId });
    if (r?.ok) return r.items;
    if (r?.error === 'NOT_LOGGED_IN') throw new Error('NOT_LOGGED_IN');
    await sleep(800);
  }
  return null;
}

/** mode: 'new' 只掃新訂單（遇到已存在訂單即停止）；'all' 掃全部並補抓缺少的明細 */
async function runScan(mode) {
  if (running) return;
  running = true;
  cancelled = false;
  await setState({ running: true, mode, page: 0, totalPages: 0, fetched: 0, failed: 0, error: '', finishedAt: 0 });

  try {
    await ensureOffscreen();
    const { bwOrders = [] } = await chrome.storage.local.get('bwOrders');
    const orders = new Map(bwOrders.map((o) => [o.orderId, o]));
    let page = 1, totalPages = 1, fetched = 0, failed = 0, stop = false;

    while (page <= totalPages && !stop && !cancelled) {
      const r = await ask({ type: 'FETCH_LIST_PAGE', page });
      if (!r?.ok) throw new Error(r?.error || '無法讀取訂單列表');
      totalPages = Math.max(totalPages, r.totalPages);
      await setState({ page, totalPages });

      for (const o of r.orders) {
        if (cancelled) break;
        if (o.status !== PAID) continue;
        const old = orders.get(o.orderId);
        if (mode === 'new' && old) { stop = true; break; }
        if (old?.items) {
          orders.set(o.orderId, { ...old, ...o, items: old.items });
          continue;
        }
        const items = await fetchDetail(o.orderId);
        if (items) fetched++; else failed++;
        orders.set(o.orderId, items ? { ...o, items } : { ...o });
        await setState({ fetched, failed });
        await sleep(DETAIL_DELAY_MS);
      }

      await chrome.storage.local.set({ bwOrders: [...orders.values()], bwLastScan: Date.now() });
      page++;
      if (page <= totalPages && !stop) await sleep(PAGE_DELAY_MS);
    }
    await setState({ running: false, finishedAt: Date.now(), error: cancelled ? '已停止' : '' });
  } catch (e) {
    await setState({
      running: false, finishedAt: Date.now(),
      error: e.message === 'NOT_LOGGED_IN' ? '尚未登入 BookWalker，請先登入後再掃描' : e.message,
    });
  } finally {
    running = false;
    chrome.offscreen.closeDocument().catch(() => {});
  }
}

/** 讀取購物車：書單與售價來自 /cart，原價來自各商品頁（有快取） */
async function runCartRead() {
  if (running) return;
  running = true;
  const setCart = (patch) => chrome.storage.local.get('bwCartState').then(({ bwCartState }) =>
    chrome.storage.local.set({ bwCartState: { ...(bwCartState || {}), ...patch } }));
  await setCart({ running: true, done: 0, total: 0, error: '' });
  try {
    await ensureOffscreen();
    const r = await ask({ type: 'FETCH_CART' });
    if (!r?.ok) throw new Error(r?.error || '無法讀取購物車');
    const { bwCartItems = [], bwPriceCache = {} } = await chrome.storage.local.get(['bwCartItems', 'bwPriceCache']);
    const prev = new Map(bwCartItems.map((it) => [it.productId, it]));
    await setCart({ total: r.items.length });

    const cartItems = [];
    for (const it of r.items) {
      let orig = bwPriceCache[it.productId]?.orig ?? null;
      if (orig === null) {
        const p = await ask({ type: 'FETCH_PRODUCT', productId: it.productId });
        if (p?.ok && p.orig) { orig = p.orig; bwPriceCache[it.productId] = { orig }; }
        await sleep(DETAIL_DELAY_MS);
      }
      cartItems.push({
        ...it, orig: orig ?? it.sale, origUnknown: orig === null,
        source: 'cart', selected: prev.get(it.productId)?.selected ?? true,
      });
      await setCart({ done: cartItems.length });
    }
    const ids = new Set(cartItems.map((it) => it.productId));
    const others = bwCartItems.filter((it) => it.source !== 'cart' && !ids.has(it.productId));
    await chrome.storage.local.set({ bwCartItems: [...cartItems, ...others], bwPriceCache });
    await setCart({ running: false });
  } catch (e) {
    await setCart({
      running: false,
      error: e.message === 'NOT_LOGGED_IN' ? '尚未登入 BookWalker，請先登入後再讀取' : e.message,
    });
  } finally {
    running = false;
    chrome.offscreen.closeDocument().catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === 'offscreen') return;
  if (msg.type === 'READ_CART') {
    if (running) { sendResponse({ ok: false }); return; }
    runCartRead();
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'START_SCAN') {
    if (running) { sendResponse({ ok: false }); return; }
    runScan(msg.mode === 'new' ? 'new' : 'all');
    sendResponse({ ok: true });
  } else if (msg.type === 'STOP_SCAN') {
    cancelled = true;
    sendResponse({ ok: true });
  }
});

// service worker 被回收後，殘留的 running 狀態需清掉
const resetRunning = () => {
  setState({ running: false });
  chrome.storage.local.get('bwCartState').then(({ bwCartState }) =>
    chrome.storage.local.set({ bwCartState: { ...(bwCartState || {}), running: false } }));
};
chrome.runtime.onStartup.addListener(resetRunning);
chrome.runtime.onInstalled.addListener(resetRunning);
