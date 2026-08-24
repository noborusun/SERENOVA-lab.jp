// Polymarket「人気上昇中」ページを 9:16(1080x1920)で撮影するスクリプト
// 実行: node scripts/capture.js

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const TARGET_URL = 'https://polymarket.com/ja';
const OUTPUT_DIR = path.join(__dirname, '..', 'screenshots');
const VIEWPORT = { width: 1080, height: 1920 };

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

(async () => {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2, // Retina相当の高解像度で撮る
    locale: 'ja-JP',
  });
  const page = await context.newPage();

  console.log(`Opening ${TARGET_URL} ...`);
  await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 60000 });

  // マーケットカードが描画されるまで待つ
  await page.waitForTimeout(4000);

  // ヘッダー〜カード数枚が収まる範囲だけを切り出す(全ページ長尺スクショにしない)
  const filename = `polymarket_${formatDate(new Date())}.png`;
  const outputPath = path.join(OUTPUT_DIR, filename);

  await page.screenshot({
    path: outputPath,
    clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
  });

  console.log(`Saved: ${outputPath}`);

  // 「latest.png」という固定名でも保存しておく(動画編集時に毎回同じファイル名で拾える)
  fs.copyFileSync(outputPath, path.join(OUTPUT_DIR, 'latest.png'));

  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
