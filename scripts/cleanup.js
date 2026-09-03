// 哨戒班(しょうかいはん) - 容量管理スクリプト
// screenshots/YYYY-MM-DD/ フォルダのうち、3か月より古いものを削除する。
//
// 実行: node scripts/cleanup.js

const path = require('path');
const fs = require('fs');

const OUTPUT_ROOT = path.join(__dirname, '..', 'screenshots');
const RETENTION_MONTHS = 3;

(async () => {
  if (!fs.existsSync(OUTPUT_ROOT)) {
    console.log('screenshots フォルダがまだ存在しません。何もしません。');
    return;
  }

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);

  const entries = fs.readdirSync(OUTPUT_ROOT, { withFileTypes: true });
  let deletedCount = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // フォルダ名は YYYY-MM-DD 形式のはず
    const folderDate = new Date(entry.name);
    if (isNaN(folderDate.getTime())) continue; // 想定外の名前は触らない

    if (folderDate < cutoff) {
      const fullPath = path.join(OUTPUT_ROOT, entry.name);
      fs.rmSync(fullPath, { recursive: true, force: true });
      console.log(`削除: ${entry.name}(${RETENTION_MONTHS}か月経過)`);
      deletedCount++;
    }
  }

  console.log(`完了: ${deletedCount}件のフォルダを削除しました。`);
})();

