const $ = (id) => document.getElementById(id);

function fmtTime(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function render(s, lastScan, count) {
  const running = !!s?.running;
  $('scan-all').style.display = running ? 'none' : '';
  $('scan-new').style.display = running ? 'none' : '';
  $('scan-stop').style.display = running ? '' : 'none';
  $('track').style.display = running ? 'block' : 'none';

  const st = $('status');
  st.classList.toggle('err', !running && !!s?.error && s.error !== '已停止');
  if (running) {
    const pct = s.totalPages ? Math.round((s.page / s.totalPages) * 100) : 0;
    $('fill').style.width = pct + '%';
    st.textContent = s.totalPages ? `掃描中… 第 ${s.page}/${s.totalPages} 頁，已抓 ${s.fetched} 筆明細` : '掃描中…';
  } else if (s?.error) {
    st.textContent = s.error;
  } else if (lastScan) {
    st.textContent = `上次掃描：${fmtTime(lastScan)}（${count} 筆訂單）`;
  } else {
    st.textContent = '尚未掃描';
  }
}

async function refresh() {
  const d = await chrome.storage.local.get(['bwScanState', 'bwLastScan', 'bwOrders']);
  render(d.bwScanState, d.bwLastScan, (d.bwOrders || []).length);
}

$('open-dash').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
});
$('scan-all').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'START_SCAN', mode: 'all' }));
$('scan-new').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'START_SCAN', mode: 'new' }));
$('scan-stop').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'STOP_SCAN' }));
chrome.storage.onChanged.addListener(refresh);
refresh();
