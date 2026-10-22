// 哨戒班レポート(MD) → note記事の貼り付け用ブロック(MD)に変換する
// 使い方: node scripts/make_note_block.js [入力MD] [出力MD]
// 既定:   reports/latest.md → reports/note_block.md
// 依存ライブラリなし(Node標準のみ)。analyze.js の後に実行する。

const fs = require('fs');

const IN = process.argv[2] || 'reports/latest.md';
const OUT = process.argv[3] || 'reports/note_block.md';
const REPO_BLOB = 'https://github.com/noborusun/SERENOVA-lab.jp/blob/main/reports';

const md = fs.readFileSync(IN, 'utf8');

// 日付(見出し「# 哨戒班レポート YYYY-MM-DD」から取得)
const dateMatch = md.match(/^#\s*哨戒班レポート\s+(\d{4}-\d{2}-\d{2})/m);
if (!dateMatch) throw new Error('見出しから日付を取得できません: ' + IN);
const date = dateMatch[1];
const [y, m, d] = date.split('-');
const dateJa = `${y}年${Number(m)}月${Number(d)}日`;

// 比較表の行を取り出す(| 項目 | 数値 | 前回 | 今回 | コメント |)
const rows = md
  .split('\n')
  .filter((l) => l.startsWith('|'))
  .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
  .filter((c) => c.length >= 5 && c[0] !== '項目' && !/^-+$/.test(c[0]));

const pct = (s) => {
  const mm = /(-?\d+(?:\.\d+)?)\s*%/.exec(s || '');
  return mm ? parseFloat(mm[1]) : null;
};

let firstWeekCount = 0;
const lines = rows.map(([item, value, prev, now, comment]) => {
  const p = pct(prev);
  const n = pct(now);
  let change;
  if (p === null || n === null) {
    change = '―';
    firstWeekCount++;
  } else {
    const diff = Math.round((n - p) * 10) / 10;
    change = diff === 0 ? '±0pt' : `${diff > 0 ? '▲' : '▼'}${Math.abs(diff)}pt`;
  }
  // 「新しいマーケット…前回比較なし」系の定型コメントは表に出さない(末尾で1回だけ注記)
  const note = /前回比較なし/.test(comment || '') || /^[-―]?$/.test(comment || '') ? '' : comment;
  return `| ${item} | ${value} | ${now} | ${change}${note ? ' ' + note : ''} |`;
});

const reportUrl = `${REPO_BLOB}/${date}_report.md`;

const block = `## 🆕 今週の哨戒班レポート（予測市場ウォッチ）

SERENOVAの「哨戒班」が、Polymarket（予測市場）の確率データを毎週機械的に集めました。${dateJa}時点です。

| 項目 | 何の確率か | 今回 | 前回比 |
|---|---|---|---|
${lines.join('\n')}

${firstWeekCount > 0 ? '※「―」は比較対象の前回データがない項目です（マーケット・基準項目の切替直後など）。\n' : ''}※「何の確率か」は、↑$100＝その価格に一度でも到達する確率、75,000-80,000＝年末終値がその区分に入る確率、という意味です。
※月次マーケット（原油・S&P500）は月初にリセットされるため、月をまたぐ比較は行いません。

▶ 全9項目の詳細レポート（毎週更新）
${reportUrl}

※本レポートは予測市場の確率データを機械的に収集・比較したものです。特定の銘柄・商品の投資判断を推奨するものではありません。
`;

const topNotice = `🆕 今回から、記事の最後に「哨戒班レポート（週次）」のコーナーを追加しました。予測市場が示す確率を、毎週そのまま並べる客観データです。`;

fs.writeFileSync(
  OUT,
  `<!-- 記事の「一番上」に置く一文 -->\n${topNotice}\n\n<!-- 記事の「日銀シリーズ本文＋セレノバからの一言」の後、標準フッターの前に置く -->\n${block}`
);
console.log(`wrote ${OUT} (${rows.length} rows, date ${date})`);
