// 哨戒班(しょうかいはん) - 巡航ミサイル型情報収集アプリ
// 毎週火曜9:00(JST)に9つのPolymarketページを巡回し、
// スクリーンショットと確率データを収集する。
//
// 変更履歴
// 2026-10-07: 「米国からアクセスしているようです」モーダルを自動で閉じる処理を追加
// 2026-10-08: ①WTI・S&P500は月次マーケット(月ごとにURLが変わる)のため、
//               実行日の月からURLを自動生成するように変更
//             ②「基準項目」(例: ↑$90)を指定すると、その項目の確率を
//               狙い撃ちで取得するように変更(比較の「数値」列に使う)
//
// 実行: node scripts/collect.js

const path = require('path');
const fs = require('fs');

const OUTPUT_ROOT = path.join(__dirname, '..', 'screenshots');
const DATA_FILE = path.join(__dirname, '..', 'data', 'history.json');
const VIEWPORT = { width: 1080, height: 1920 };

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

// 月次マーケットのURLを実行日の月から組み立てる
// 例: what-price-will-wti-hit-in-october-2026
function monthlyUrl(prefix, now) {
  return `https://polymarket.com/ja/event/${prefix}-${MONTHS[now.getMonth()]}-${now.getFullYear()}`;
}

// ここが監視対象の9マーケット。
//   slug  : ファイル名・履歴の照合に使う短い名前(変更しないこと)
//   label : レポート表示用の名前
//   watch : 「基準項目」。ページ内のこの行の確率を比較に使う。nullなら
//           ページ内で一番大きい%を仮の代表値にする(精度は低い)
//           書き方の例: '↑$90' '↑150' '↓$85'(全角・「ドル」表記ゆれは自動で吸収)
function buildTargets(now) {
  return [
    { id: '01', slug: 'nikkei225', label: '日経225(年末終値)', url: 'https://polymarket.com/ja/event/nikkei-225-close-price-end-of-2026', watch: null },
    { id: '02', slug: 'usdjpy', label: 'USD/JPY(年末終値)', url: 'https://polymarket.com/ja/event/usdjpy-close-price-end-of-2026', watch: '↑150' },
    { id: '03', slug: 'wti', label: 'WTI原油', url: monthlyUrl('what-price-will-wti-hit-in', now), watch: '↑$90' },
    { id: '04', slug: 'gold', label: 'ゴールド(GC)', url: 'https://polymarket.com/ja/event/what-will-gold-gc-hit-by-end-of-december', watch: null },
    { id: '05', slug: 'spy', label: 'S&P500', url: monthlyUrl('what-price-will-spy-hit-in', now), watch: null },
    { id: '06', slug: 'midterms', label: '2026年中間選挙', url: 'https://polymarket.com/ja/event/balance-of-power-2026-midterms', watch: null },
    { id: '07', slug: 'hormuz', label: 'ホルムズ海峡交通', url: 'https://polymarket.com/ja/event/strait-of-hormuz-traffic-returns-to-normal-by-september-30-20260702154339440', watch: null },
    { id: '08', slug: 'iran', label: 'イラン封鎖解除', url: 'https://polymarket.com/ja/event/us-announces-end-of-iranian-blockade-byptptpt-20260713152715080', watch: null },
    { id: '09', slug: 'fedhike', label: 'FRB利上げ', url: 'https://polymarket.com/ja/event/fed-rate-hike-by', watch: null },
  ];
}

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

// 「↑ $90」「↑ 95ドル」「↑150」「↓ $85」などの表記から、矢印と数値を取り出す。
// 全角($、数字)・カンマ・「ドル」・行末のVol.表記などの違いを吸収する。
function parseLabel(s) {
  const t = String(s).normalize('NFKC').trim();
  const m = t.match(/^([↑↓])\s*\$?\s*([\d,]+(?:\.\d+)?)/);
  if (!m) return null;
  return { arrow: m[1], value: parseFloat(m[2].replace(/,/g, '')) };
}

// ページ全文から、基準項目(例: '↑$90')の行を探し、その行の確率(%)を返す。
// 見つからなければ null。「<1%」は 0.5 として扱う。
function findWatchPct(text, watchLabel) {
  const want = parseLabel(watchLabel);
  if (!want) return null;
  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const got = parseLabel(lines[i]);
    if (!got || got.arrow !== want.arrow || got.value !== want.value) continue;

    // この行の少し後ろにある、最初の「NN%」がこの項目の確率
    for (let j = i + 1; j < Math.min(i + 9, lines.length); j++) {
      const n = lines[j].normalize('NFKC').replace(/\s+/g, '');
      if (/^[↑↓]/.test(n)) break; // 次の選択肢の行に入ったので打ち切り
      const m = n.match(/^(<)?(\d{1,3}(?:\.\d+)?)%/);
      if (m) return m[1] ? 0.5 : parseFloat(m[2]);
    }
  }
  return null;
}

// ページ内のテキストから「NN%」を拾う(基準項目を指定していないマーケット用の予備)
function extractOdds(text) {
  const matches = String(text).match(/\d{1,3}(\.\d+)?%/g) || [];
  return matches.slice(0, 6);
}

// 「米国からアクセスしているようです」モーダルを閉じる。
// 1) 「閲覧専用モードで続行」リンクをクリック(データは背景にそのまま表示される)
// 2) なければ右上の×ボタン
// 3) それでも残っていたらEscキー、最後の手段としてDOMからダイアログを取り除く
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

  try {
    const dialog = page.locator('[role="dialog"]').first();
    if (await dialog.isVisible({ timeout: 1000 })) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(800);
      if (!(await dialog.isVisible({ timeout: 500 }))) return true;

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

async function main() {
  const { chromium } = require('playwright');

  const today = new Date();
  const dateStr = formatDate(today);
  const dayDir = path.join(OUTPUT_ROOT, dateStr);
  fs.mkdirSync(dayDir, { recursive: true });

  const TARGETS = buildTargets(today);

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
    console.log(`[${target.id}] Opening ${target.label} ... ${target.url}`);
    try {
      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 60000 });

      await page.waitForTimeout(4000);
      let modalHandled = await dismissGeoModal(page);
      await page.waitForTimeout(3000);
      modalHandled = (await dismissGeoModal(page)) || modalHandled;

      const filename = `${target.id}_${target.slug}.png`;
      const outputPath = path.join(dayDir, filename);
      await page.screenshot({ path: outputPath, clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height } });

      const text = await page.evaluate(() => document.body.innerText).catch(() => '');
      const odds = extractOdds(text);
      const watchPct = target.watch ? findWatchPct(text, target.watch) : null;

      todayRecords.push({
        date: dateStr,
        id: target.id,
        slug: target.slug,
        label: target.label,
        url: target.url,
        screenshot: path.relative(path.join(__dirname, '..'), outputPath),
        odds,
        watchLabel: target.watch || null,
        watchPct, // 基準項目の確率(%)。見つからなければ null
        modalDismissed: modalHandled,
        status: 'ok',
      });
      console.log(`  -> saved ${filename}, modal: ${modalHandled ? 'closed' : 'none'}, ` +
        (target.watch ? `watch ${target.watch} = ${watchPct === null ? '(見つからず)' : watchPct + '%'}` : `odds sample: ${odds.join(', ') || '(取得できず)'}`));
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
        watchLabel: target.watch || null,
        watchPct: null,
        status: 'error',
        error: e.message,
      });
    } finally {
      await page.close();
    }
  }

  await browser.close();

  const filtered = history.filter((h) => h.date !== dateStr);
  const merged = [...filtered, ...todayRecords].sort((a, b) => a.date.localeCompare(b.date));
  saveHistory(merged);

  console.log(`\n完了: ${dateStr} 分、${todayRecords.length}件を記録しました。`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { parseLabel, findWatchPct, extractOdds, monthlyUrl, buildTargets };
