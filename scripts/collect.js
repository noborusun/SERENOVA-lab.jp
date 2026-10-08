// 哨戒班(しょうかいはん) - 巡航ミサイル型情報収集アプリ
// 毎週火曜9:00(JST)に9つのPolymarketページを巡回し、
// スクリーンショットと簡易データを収集する。
//
// 修正点(2026-10-07): GitHub Actionsのサーバーは米国にあるため、Polymarketが
// 「米国からアクセスしているようです」というモーダルを表示する。
// 撮影前にこのモーダルを自動で閉じる処理(dismissGeoModal)を追加。
//
// 実行: node scripts/collect.js

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUTPUT_ROOT = path.join(__dirname, '..', 'screenshots');
const DATA_FILE = path.join(__dirname, '..', 'data', 'history.json');
const VIEWPORT = { width: 1080, height: 1920 };

// ここが監視対象の9マーケット。Notion仕様書のリストと対応させている。
// slugはファイル名用、labelはレポート表示用の短い名前。
const TARGETS = [
  { id: '01', slug: 'nikkei225', label: '日経225(年末終値)', url: 'https://polymarket.com/ja/event/nikkei-225-close-price-end-of-2026' },
  { id: '02', slug: 'usdjpy', label: 'USD/JPY(年末終値)', url: 'https://polymarket.com/ja/event/usdjpy-close-price-end-of-2026' },
  { id: '03', slug: 'wti', label: 'WTI原油', url: 'https://polymarket.com/ja/event/what-price-will-wti-hit-in-august-2026' },
  { id: '04', slug: 'gold', label: 'ゴールド(GC)', url: 'https://polymarket.com/ja/event/what-will-gold-gc-hit-by-end-of-december' },
  { id: '05', slug: 'spy', label: 'S&P500', url: 'https://polymarket.com/ja/event/what-price-will-spy-hit-in-august-2026' },
  { id: '06', slug: 'midterms', label: '2026年中間選挙', url: 'https://polymarket.com/ja/event/balance-of-power-2026-midterms' },
  { id: '07', slug: 'hormuz', label: 'ホルムズ海峡交通', url: 'https://polymarket.com/ja/event/strait-of-hormuz-traffic-returns-to-normal-by-september-30-20260702154339440' },
  { id: '08', slug: 'iran', label: 'イラン封鎖解除', url: 'https://polymarket.com/ja/event/us-announces-end-of-iranian-blockade-byptptpt-20260713152715080' },
  { id: '09', slug: 'fedhike', label: 'FRB利上げ', url: 'https://polymarket.com/ja/event/fed-rate-hike-by' },
];

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function loadHistory() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (e) {
    console.error('history.json の読み込みに失敗、空配列から再開します:', e.message);
    return [];
  }
}

function saveHistory(history) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(history, null, 2), 'utf-8');
}

// 「米国からアクセスしているようです」モーダルを閉じる。
// 1) 「閲覧専用モードで続行」リンクをクリック(データは背景にそのまま表示される)
// 2) なければ右上の×ボタン
// 3) それでも残っていたらEscキー、最後の手段としてDOMからダイアログを取り除く
// 戻り値: 何かしらの方法でモーダルを処理できたら true
async function dismissGeoModal(page) {
  const candidates = [
    page.getByText('閲覧専用モードで続行'),
    page.getByRole('button', { name: /閲覧専用モードで続行|view[- ]only/i }),
    page.locator('[role="dialog"] button[aria-label*="lose" i]'),
    page.locator('[role="dialog"] button[aria-label*="閉じる"]'),
  ];

  for (const locator of candidates) {
    try {
      const el = locator.first();
      if (await el.isVisible({ timeout: 1500 })) {
        await el.click({ timeout: 3000 });
        await page.waitForTimeout(1000);
        return true;
      }
    } catch (e) {
      // この候補は見つからなかった。次の候補へ。
    }
  }

  // ボタンが見つからなかった場合: Escで閉じる
  try {
    const dialog = page.locator('[role="dialog"]').first();
    if (await dialog.isVisible({ timeout: 1000 })) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(800);
      if (!(await dialog.isVisible({ timeout: 500 }))) return true;

      // それでも残っていたら、DOMから直接取り除く(撮影専用の最終手段)
      await page.evaluate(() => {
        document.querySelectorAll('[role="dialog"]').forEach((el) => el.remove());
        document.querySelectorAll('[data-state="open"][aria-hidden="true"], .fixed.inset-0').forEach((el) => el.remove());
        document.body.style.overflow = 'auto';
      });
      await page.waitForTimeout(500);
      return true;
    }
  } catch (e) {
    // ダイアログ自体が無かった
  }
  return false;
}

// ページ内のテキストから「NN%」のような確率表記をざっくり拾う。
// Polymarketはマーケットごとに表示形式が違う(Yes/No、複数選択肢など)ため、
// 完全な自動判定はせず、目視確認の手がかりとして最初の数個だけ保存する。
async function extractOdds(page) {
  try {
    const text = await page.evaluate(() => document.body.innerText);
    const matches = text.match(/\d{1,3}(\.\d+)?%/g) || [];
    return matches.slice(0, 6); // 最初の6個だけ(主要な選択肢の確率を想定)
  } catch (e) {
    return [];
  }
}

(async () => {
  const today = new Date();
  const dateStr = formatDate(today);
  const dayDir = path.join(OUTPUT_ROOT, dateStr);
  fs.mkdirSync(dayDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    locale: 'ja-JP',
  });

  const history = loadHistory();
  const todayRecords = [];

  for (const target of TARGETS) {
    const page = await context.newPage();
    console.log(`[${target.id}] Opening ${target.label} ...`);
    try {
      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 60000 });

      // モーダルは読み込み後に少し遅れて出ることがあるため、待ってから閉じる
      await page.waitForTimeout(4000);
      let modalHandled = await dismissGeoModal(page);

      // さらに待って、遅れて出てきた場合に備えてもう一度チェック
      await page.waitForTimeout(3000);
      modalHandled = (await dismissGeoModal(page)) || modalHandled;

      const filename = `${target.id}_${target.slug}.png`;
      const outputPath = path.join(dayDir, filename);
      await page.screenshot({ path: outputPath, clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height } });

      const odds = await extractOdds(page);

      todayRecords.push({
        date: dateStr,
        id: target.id,
        slug: target.slug,
        label: target.label,
        url: target.url,
        screenshot: path.relative(path.join(__dirname, '..'), outputPath),
        odds, // 賞味期限切れ(イベント終了)のマーケットは、ここが空になりやすい → 3参照の判定に使える
        modalDismissed: modalHandled,
        status: 'ok',
      });
      console.log(`  -> saved ${filename}, modal: ${modalHandled ? 'closed' : 'none'}, odds sample: ${odds.join(', ') || '(取得できず)'}`);
    } catch (e) {
      console.error(`  -> 失敗: ${e.message}`);
      todayRecords.push({
        date: dateStr,
        id: target.id,
        slug: target.slug,
        label: target.label,
        url: target.url,
        screenshot: null,
        odds: [],
        status: 'error',
        error: e.message,
      });
    } finally {
      await page.close();
    }
  }

  await browser.close();

  // 同じ日付の既存レコードがあれば入れ替え、なければ追加
  const filtered = history.filter((h) => h.date !== dateStr);
  const merged = [...filtered, ...todayRecords].sort((a, b) => a.date.localeCompare(b.date));
  saveHistory(merged);

  console.log(`\n完了: ${dateStr} 分、${todayRecords.length}件を記録しました。`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
