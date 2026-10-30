/**
 * BookWalker 商品頁小工具：顯示原價／折數，並可把這本書加入擴充功能的「購物車試算」清單。
 * 試算本身在擴充功能的統計頁（購物車頁籤）。
 */

(function () {
  if (document.getElementById('bw-price-helper')) return;

  const svgIcon = (paths, size = 15) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:6px;">${paths}</svg>`;
  const ICON_PLUS = svgIcon('<path d="M5 12h14"/><path d="M12 5v14"/>');
  const ICON_CHECK = svgIcon('<path d="M20 6 9 17l-5-5"/>');

  function getBookInfo() {
    const title = (document.querySelector('h1.product-basic-info-name') || document.querySelector('.bwname h1'))
      ?.textContent?.trim() || '';
    const saleText = (document.querySelector('.product-price-value') || document.getElementById('view_price_inner'))?.textContent || '0';
    const salePrice = parseInt(saleText.replace(/[^0-9]/g, '') || '0', 10);
    const origText = (document.querySelector('.product-strike-price') || document.getElementById('show_price_inner'))?.textContent || '';
    const om = origText.match(/\d+/);
    const origPrice = om ? parseInt(om[0], 10) : salePrice;
    const idm = location.pathname.match(/\/product\/([^/?#]+)/);
    const category = document.querySelector('.product-basic-info-type, .product-category')?.textContent?.trim() || '';
    return { productId: idm ? idm[1] : '', title, salePrice, origPrice, category };
  }

  function getMemberLevel() {
    const el = document.querySelector('.memberLv .lvNum');
    const lv = el ? parseInt(el.textContent.trim(), 10) : NaN;
    return isNaN(lv) ? null : lv;
  }

  async function getCart() {
    const { bwCartItems = [] } = await chrome.storage.local.get('bwCartItems');
    return bwCartItems;
  }

  function inject(info) {
    const anchor = document.querySelector('.product-promotion') || document.getElementById('bw_buy');
    if (!anchor) return false;

    const disc = info.origPrice > 0 ? Math.round((info.salePrice / info.origPrice) * 100) / 10 : 10;

    const wrap = document.createElement('div');
    wrap.id = 'bw-price-helper';
    wrap.style.cssText = 'margin-top:18px;padding:18px 20px;background:#faf8f6;border:1px solid #ece4df;border-radius:16px;font-size:13px;color:#231815;line-height:1.6;';
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
        <div>
          <div style="font-size:11px;font-weight:600;color:#9a7c67;">BookWalker 小工具</div>
          <span style="font-size:24px;font-weight:700;color:#b8454a;line-height:1.3;">${disc}</span><span style="font-size:13px;font-weight:600;color:#b8454a;margin-left:3px;">折</span>
        </div>
        <button id="bwph-add" style="display:inline-flex;align-items:center;padding:7px 14px;background:#846551;color:#fff;border:1px solid #846551;border-radius:10px;font-size:13px;font-weight:500;cursor:pointer;"></button>
      </div>`;
    anchor.insertAdjacentElement(anchor.id === 'bw_buy' ? 'beforeend' : 'afterend', wrap);

    const btn = wrap.querySelector('#bwph-add');
    const paint = (inCart) => {
      btn.innerHTML = inCart ? `${ICON_CHECK}已在試算清單（點擊移除）` : `${ICON_PLUS}加入購物車試算`;
      btn.style.background = inCart ? '#fff' : '#846551';
      btn.style.color = inCart ? '#5f493a' : '#fff';
    };
    getCart().then((items) => paint(items.some((it) => it.productId === info.productId)));
    btn.addEventListener('click', async () => {
      const items = await getCart();
      const has = items.some((it) => it.productId === info.productId);
      const next = has
        ? items.filter((it) => it.productId !== info.productId)
        : [...items, {
            productId: info.productId, title: info.title, category: info.category,
            orig: info.origPrice, sale: info.salePrice, source: 'page', selected: true,
          }];
      await chrome.storage.local.set({ bwCartItems: next });
      paint(!has);
    });
    return true;
  }

  function init() {
    const info = getBookInfo();
    if (!info.salePrice || !info.title || !info.productId) return false;
    const lv = getMemberLevel();
    if (lv !== null) chrome.storage.local.set({ bwMemberLv: lv });
    return inject(info);
  }

  function waitAndInit() {
    if (document.getElementById('bw-price-helper') || init()) return;
    let attempts = 0;
    const observer = new MutationObserver(() => {
      attempts++;
      if (document.getElementById('bw-price-helper') || init() || attempts > 100) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', waitAndInit);
  else setTimeout(waitAndInit, 800);
})();
