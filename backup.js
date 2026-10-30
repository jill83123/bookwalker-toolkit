/**
 * 備份／還原：手動匯出／匯入 JSON。
 */

async function buildBackup() {
  const { bwOrders = [], bwSettings = {} } = await chrome.storage.local.get(['bwOrders', 'bwSettings']);
  return {
    app: 'bw-spending',
    version: 2,
    exportedAt: new Date().toISOString(),
    bwOrders,
    settings: { includeFree: !!bwSettings.includeFree },
  };
}

async function applyBackup(data) {
  if (!data || !Array.isArray(data.bwOrders)) throw new Error('備份檔格式不正確');
  const { bwSettings = {} } = await chrome.storage.local.get('bwSettings');
  await chrome.storage.local.set({
    bwOrders: data.bwOrders,
    bwSettings: { ...bwSettings, includeFree: !!data.settings?.includeFree },
    bwLastScan: Date.now(),
  });
  return data.bwOrders.length;
}
