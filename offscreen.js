/**
 * Offscreen document：fetch + DOMParser（service worker 沒有 DOMParser）
 * 只負責抓取與解析，儲存由 background 處理。
 */

const MEMBER = 'https://member.bookwalker.com.tw';

async function fetchDoc(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (/login|signin/i.test(new URL(res.url).pathname)) throw new Error('NOT_LOGGED_IN');
  const html = await res.text();
  return new DOMParser().parseFromString(html, 'text/html');
}

function parseTotalPages(doc) {
  const pg = doc.querySelector('ul.bw_pagination');
  if (!pg) return 1;
  let max = 1;
  pg.querySelectorAll('li a, li span').forEach((el) => {
    const n = parseInt(el.textContent.trim(), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return max;
}

function parseOrders(doc) {
  const orders = [];
  doc.querySelectorAll('div.buyList').forEach((block) => {
    const tableList = block.querySelector('ul.tableList');
    if (!tableList) return;
    let orderId = '', dateStr = '', status = '', amount = null;
    tableList.querySelectorAll('li').forEach((li) => {
      const label = li.querySelector('b.mTableItem')?.textContent?.trim() || '';
      const val = li.querySelector('p')?.textContent?.trim() || '';
      if (li.classList.contains('mTbFirst')) orderId = val;
      if (li.classList.contains('mTbLast')) dateStr = val;
      if (label === '訂單狀態') status = val;
      if (label === '結帳金額') {
        const m = val.replace(/,/g, '').match(/\d+/);
        amount = m ? parseInt(m[0], 10) : 0;
      }
    });
    const dm = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!orderId || !dm || amount === null) return;
    orders.push({
      orderId,
      year: +dm[1], month: +dm[2], day: +dm[3],
      amount, status,
    });
  });
  return orders;
}

function parseItems(doc) {
  const items = [];
  doc.querySelectorAll('ul.buyDetailList > li').forEach((li) => {
    const title = li.querySelector('span.pro-name')?.textContent?.trim() || '';
    const href = li.querySelector('a[href*="/product/"]')?.getAttribute('href') || '';
    const pm = href.match(/\/product\/([^/?#]+)/);
    const category = li.querySelector('p')?.textContent?.trim() || '';
    const m = li.textContent.replace(/,/g, '').match(/\$\s*(\d+)\s*\(\s*(\d+)\s*本\s*\)/);
    if (!title || !m) return;
    items.push({
      productId: pm ? pm[1] : '',
      title, category,
      price: parseInt(m[1], 10),
      qty: parseInt(m[2], 10),
    });
  });
  return items;
}

const SHOP = 'https://www.bookwalker.com.tw';

function parseCart(doc) {
  const items = [];
  doc.querySelectorAll('ul.cartBuyCon').forEach((ul) => {
    const productId = ul.querySelector('input[data-product_id]')?.dataset.product_id || '';
    const title = ul.querySelector('.buyBookName')?.textContent?.trim() || '';
    const category = ul.querySelector('.buyBookType')?.textContent?.trim() || '';
    const sale = parseInt((ul.querySelector('.priceTxt')?.textContent || '').replace(/,/g, ''), 10);
    if (productId && title && !isNaN(sale)) items.push({ productId, title, category, sale });
  });
  return items;
}

/** 商品頁是 SPA，價格不在 DOM；原價在 FB 追蹤事件的第一筆 ViewContent item_price */
function parseProductPrices(html) {
  const i = html.indexOf('"name":"ViewContent"');
  if (i < 0) return { orig: null };
  const m = html.slice(i, i + 800).match(/"item_price":(\d+)/);
  return { orig: m ? parseInt(m[1], 10) : null };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;
  (async () => {
    try {
      if (msg.type === 'FETCH_CART') {
        const doc = await fetchDoc(`${SHOP}/cart`);
        sendResponse({ ok: true, items: parseCart(doc) });
        return;
      }
      if (msg.type === 'FETCH_PRODUCT') {
        const res = await fetch(`${SHOP}/product/${encodeURIComponent(msg.productId)}`, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        sendResponse({ ok: true, ...parseProductPrices(await res.text()) });
        return;
      }
      if (msg.type === 'FETCH_LIST_PAGE') {
        const doc = await fetchDoc(`${MEMBER}/order/list?page=${msg.page}`);
        sendResponse({ ok: true, orders: parseOrders(doc), totalPages: parseTotalPages(doc) });
      } else if (msg.type === 'FETCH_DETAIL') {
        const doc = await fetchDoc(`${MEMBER}/order/detail/${encodeURIComponent(msg.orderId)}`);
        sendResponse({ ok: true, items: parseItems(doc) });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true;
});
