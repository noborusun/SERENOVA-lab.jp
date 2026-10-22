// 哨戒班レポート(MD) → note記事の貼り付け用ブロック(MD)に変換する (v2)
// 使い方: node scripts/make_note_block.js [入力MD] [出力MD]
// 既定:   reports/latest.md → reports/note_block.md
// 依存ライブラリなし(Node標準のみ)。analyze.js の後に実行する。

const fs = require('fs');

const IN = process.argv[2] || 'reports/latest.md';
const OUT = process.argv[3] || 'reports/note_block.md';
const REPO_BLOB = 'https://github.com/noborusun/SERENOVA-lab.jp/blob/main/reports';

const md = fs.readFileSync(IN, 'utf8');

const dateMatch = md.match(/^#\s*哨戒班レポート\s+(\d{4}-\d{2}-\d{2})/m);
if (!dateMatch) throw new Error('見出しから日付を取得できません: ' + IN);
const date = dateMatch[1];
const [y, m, d] = date.split('-');
const dateJa = `${y}年${Number(m)}月${Number(d)}日`;

const rows = md
  .split('\n')
  .filter((l) => l.startsWith('|'))
  .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
  .filter((c) => c.length >= 5 && c[0] !== '項目' && !/^-+$/.test(c[0]));

const pct = (s) => {
  const mm = /(-?\d+(?:\.\d+)?)\s*%/.exec(s || '');
  return mm ? parseFloat(mm[1]) : null;
};

// 「何の確率か」の読み替え(キーワード＋数値が合うときだけ置換。合わなければレポートの数値をそのまま出す)
const WHAT = [
  [/日経/, /75,000-80,000/, '年末終値が75,000〜80,000円に入る確率'],
  [/USD\/JPY/, /150-160/, '年末終値が150〜160円に入る確率'],
  [/WTI/, /\$100/, '今月中に100ドルへ到達する確率'],
  [/ゴールド/, /\$5,000/, '12月末までに5,000ドルへ到達する確率'],
  [/S&P/, /\$800/, '今月中に800ドルへ到達する確率'],
  [/中間選挙/, /民主党圧勝/, '「民主党圧勝」となる確率'],
  [/ホルムズ/, /はい/, '12月31日までに正常化する確率'],
  [/イラン封鎖解除/, /12月31日/, '12月31日までに解除される確率'],
  [/FRB/, /はい/, '年内にもう一度利上げする確率'],
];
const what = (item, value) => {
  const hit = WHAT.find(([ri, rv]) => ri.test(item) && rv.test(value));
  return hit ? hit[2] : value;
};
const GROUPS = [
  ['中東・エネルギー', /WTI|ホルムズ|イラン/],
  ['株・為替・金利・金', /日経|USD\/JPY|S&P|ゴールド|FRB/],
  ['政治', /中間選挙/],
];
const groupOf = (item) => (GROUPS.find(([, re]) => re.test(item)) || ['その他'])[0];

const parsed = rows.map(([item, value, prev, now, comment]) => {
  const p = pct(prev), n = pct(now);
  let change = '―';
  if (p !== null && n !== null) {
    const diff = Math.round((n - p) * 10) / 10;
    change = diff === 0 ? '±0pt' : `${diff > 0 ? '▲' : '▼'}${Math.abs(diff)}pt`;
  }
  return { item, text: what(item, value), prev, now, change, big: /^大きな変化/.test(comment || ''), group: groupOf(item) };
});

const order = [...GROUPS.map(([g]) => g), 'その他'];
let tables = '';
let anyBig = false, anyDash = false;
order.forEach((g) => {
  const rs = parsed.filter((r) => r.group === g);
  if (!rs.length) return;
  tables += `### ${g}\n\n| 項目 | 何の確率か | 前回 | 今回 | 変化 |\n|---|---|---|---|---|\n`;
  rs.forEach((r) => {
    if (r.big) anyBig = true;
    if (r.change === '―') anyDash = true;
    tables += `| ${r.big ? '● ' : ''}${r.item} | ${r.text} | ${r.prev} | ${r.now} | ${r.change} |\n`;
  });
  tables += '\n';
});

const notes = [
  anyBig ? '※●は、前回からの変化が大きかった項目です（レポートの判定）。' : '',
  anyDash ? '※「―」は、比較対象の前回データがない項目です（マーケット・基準項目の切替直後など）。' : '',
  '※月次マーケット（原油・S&P500）は月初にリセットされるため、月をまたぐ比較は行いません。',
].filter(Boolean).join('\n');

const block = `## 今週の哨戒班レポート（予測市場ウォッチ）

SERENOVAの「哨戒班」が、Polymarket（予測市場）の確率データを集めました。${dateJa}時点です。「前回」は、直近のレポートとの比較です。

${tables}${notes}

▶ 全9項目の詳細レポート
${REPO_BLOB}/${date}_report.md

※本レポートは予測市場の確率データを機械的に収集・比較したものです。特定の銘柄・商品の投資判断を推奨するものではありません。
`;

fs.writeFileSync(OUT, block);
console.log(`wrote ${OUT} (${rows.length} rows, date ${date})`);
