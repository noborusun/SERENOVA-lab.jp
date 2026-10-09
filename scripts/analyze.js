// 哨戒班(しょうかいはん) - 分析・比較コメント生成スクリプト
// collect.js が溜めた data/history.json を読み、
// 週/月/3か月/6か月/年 の周期ごとに比較コメントを作り、
// note にそのまま貼れる Markdown レポートを reports/ に出力する。
//
// 変更履歴
// 2026-10-08: ①比較表に「数値」列(その%が何の確率か。例: ↑$90)を追加
//             ②月次・3か月・半期・年次の比較が、実際には「直近の前回」と
//               同じ相手と比べてしまっていた不具合を修正
//               (約30日前・91日前・182日前・365日前の記録と比べる)
//             ③月次マーケットの切替(URL変更)や基準項目の変更をまたぐ比較は
//               「前回比較なし」とする(別のマーケット同士を比べないため)
//
// 実行: node scripts/analyze.js

const path = require('path');
const fs = require('fs');

const DATA_FILE = path.join(__dirname, '..', 'data', 'history.json');
const STATE_FILE = path.join(__dirname, '..', 'data', 'report_state.json');
const REPORTS_DIR = path.join(__dirname, '..', 'reports');

const BIG_CHANGE_THRESHOLD = 5; // ポイント。Notion仕様書の「5ポイント以上動いたら大きな変化」に対応

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    return fallback;
  }
}

function saveJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

function dayNumber(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

function daysBetween(a, b) {
  return dayNumber(a) - dayNumber(b);
}

// 基準項目が決まっていないマーケット用の予備: ページ内で一番大きい%を代表値にする
function leadingOdd(record) {
  if (!record || !record.odds || record.odds.length === 0) return null;
  const nums = record.odds.map((s) => parseFloat(s)).filter((n) => !isNaN(n));
  if (nums.length === 0) return null;
  return Math.max(...nums);
}

// そのレコードの「代表値(%)」。基準項目があればその確率、なければ予備の最大値
function repValue(record) {
  if (!record) return null;
  if (record.watchLabel) return typeof record.watchPct === 'number' ? record.watchPct : null;
  return leadingOdd(record);
}

// 同じ土俵で比べられるか(同じURL=同じマーケット、同じ基準項目)
function likeForLike(a, b) {
  return a.url === b.url && (a.watchLabel || null) === (b.watchLabel || null);
}

// 比較する周期の定義
//   mode 'latest': 直近の前回(最大 maxGap 日前まで)と比べる
//   mode 'around': offset日前に一番近い記録(±tol日以内)と比べる
const PERIODS = [
  { key: 'week', title: '📅 週次比較', mode: 'latest', maxGap: 14 },
  { key: 'month', title: '🗓️ 月次比較', mode: 'around', offset: 30, tol: 10 },
  { key: 'quarter', title: '📊 3か月(四半期)比較', mode: 'around', offset: 91, tol: 20 },
  { key: 'half', title: '📈 半期比較', mode: 'around', offset: 182, tol: 30 },
  { key: 'year', title: '🏆 年次比較', mode: 'around', offset: 365, tol: 45 },
];

// 過去のレコードを探す。戻り値: { rec, status }
//   status: 'ok'(比較できる) / 'switched'(マーケット・基準項目が変わった) / 'none'(過去データなし)
function findPast(history, current, period) {
  const candidates = history.filter((h) => h.slug === current.slug && h.date < current.date && h.status !== 'error');
  let pool;
  if (period.mode === 'latest') {
    pool = candidates
      .filter((h) => daysBetween(current.date, h.date) <= period.maxGap)
      .sort((a, b) => b.date.localeCompare(a.date));
  } else {
    const desired = dayNumber(current.date) - period.offset;
    pool = candidates
      .filter((h) => Math.abs(dayNumber(h.date) - desired) <= period.tol)
      .sort((a, b) => Math.abs(dayNumber(a.date) - desired) - Math.abs(dayNumber(b.date) - desired));
  }
  if (pool.length === 0) return { rec: null, status: 'none' };
  const same = pool.find((h) => likeForLike(h, current));
  if (same) return { rec: same, status: 'ok' };
  return { rec: null, status: 'switched' };
}

function fmtPct(v) {
  if (v === null || v === undefined) return '-';
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
}

function buildRows(history, targets, date, period) {
  return targets.map((t) => {
    const current = history.find((h) => h.slug === t.slug && h.date === date);
    const base = { label: t.label, basis: '最大値(自動)', past: '-', current: '取得不可', comment: '' };

    if (!current || current.status === 'error') {
      return { ...base, comment: '⚠️ データ取得失敗(ログを確認)' };
    }

    base.basis = current.watchLabel || '最大値(自動)';
    const curVal = repValue(current);
    base.current = fmtPct(curVal);

    if (current.watchLabel && curVal === null) {
      return { ...base, comment: `⚠️ 基準項目「${current.watchLabel}」がページ内で見つかりません(表示形式の変更・マーケット終了を確認)` };
    }
    if (!current.watchLabel && curVal === null) {
      return { ...base, comment: '⚠️ 確率を取得できません(マーケット終了・表示形式の変更の可能性。基準項目の指定を検討)' };
    }

    const { rec: past, status } = findPast(history, current, period);
    if (status === 'none') return { ...base, comment: '比較対象データなし(初回収集扱い)' };
    if (status === 'switched') return { ...base, comment: '新しいマーケット・基準項目に切替のため前回比較なし' };

    const pastVal = repValue(past);
    base.past = fmtPct(pastVal);
    if (pastVal === null) return { ...base, comment: '前回の確率が取得できておらず比較不可' };

    const diff = curVal - pastVal;
    const gap = daysBetween(date, past.date);
    const gapNote = period.key === 'week' && Math.abs(gap - 7) > 1 ? `(${gap}日前比)` : '';
    base.comment = Math.abs(diff) >= BIG_CHANGE_THRESHOLD
      ? `大きな変化: ${diff > 0 ? '+' : ''}${diff.toFixed(1)}pt${gapNote}`
      : `前回と同様の動き${gapNote}`;
    return base;
  });
}

function toMarkdownTable(rows) {
  const header = '| 項目 | 数値 | 前回 | 今回 | 変化・コメント |\n|---|---|---|---|---|\n';
  const body = rows.map((r) => `| ${r.label} | ${r.basis} | ${r.past} | ${r.current} | ${r.comment} |`).join('\n');
  return header + body;
}

function monthsBetween(d1, d2) {
  const a = new Date(d1);
  const b = new Date(d2);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

function generate(history, state) {
  const latestDate = history[history.length - 1].date;
  const targets = [...new Map(history.map((h) => [h.slug, { slug: h.slug, label: h.label }])).values()];
  const byKey = Object.fromEntries(PERIODS.map((p) => [p.key, p]));
  const thisMonthKey = latestDate.slice(0, 7);
  const elapsedMonths = monthsBetween(state.firstDate, latestDate);
  const sections = [];

  // 週次(毎回)
  sections.push(`## ${byKey.week.title}(${latestDate}時点)\n\n${toMarkdownTable(buildRows(history, targets, latestDate, byKey.week))}\n`);

  // 月次(月が変わった最初の実行時のみ)
  if (state.lastMonthReport !== thisMonthKey) {
    sections.push(`## ${byKey.month.title}(${thisMonthKey})\n\n${toMarkdownTable(buildRows(history, targets, latestDate, byKey.month))}\n`);
    state.lastMonthReport = thisMonthKey;
  }
  if (elapsedMonths > 0 && elapsedMonths % 3 === 0 && state.lastQuarterReport !== thisMonthKey) {
    sections.push(`## ${byKey.quarter.title}(${thisMonthKey})\n\n${toMarkdownTable(buildRows(history, targets, latestDate, byKey.quarter))}\n`);
    state.lastQuarterReport = thisMonthKey;
  }
  if (elapsedMonths > 0 && elapsedMonths % 6 === 0 && state.lastHalfReport !== thisMonthKey) {
    sections.push(`## ${byKey.half.title}(${thisMonthKey})\n\n${toMarkdownTable(buildRows(history, targets, latestDate, byKey.half))}\n`);
    state.lastHalfReport = thisMonthKey;
  }
  if (elapsedMonths > 0 && elapsedMonths % 12 === 0 && state.lastYearReport !== thisMonthKey) {
    sections.push(`## ${byKey.year.title}(${thisMonthKey})\n\n${toMarkdownTable(buildRows(history, targets, latestDate, byKey.year))}\n`);
    state.lastYearReport = thisMonthKey;
  }

  const report = [
    `# 哨戒班レポート ${latestDate}`,
    '',
    '※本レポートはPolymarket(予測市場)の確率データを機械的に収集・比較したものです。特定の投資判断を推奨するものではありません。',
    '',
    ...sections,
    '※「数値」列は、その%が何の確率かを示します(例: ↑$90 = その価格に一度でも到達する確率)。「最大値(自動)」は基準項目が未設定のため、ページ内で一番大きい%を仮に表示しています。',
    '※月次マーケット(原油・S&P500)は月初にリセットされるため、月をまたぐ比較は行いません。',
    '',
  ].join('\n');

  return { latestDate, report };
}

function main() {
  const history = loadJson(DATA_FILE, []);
  if (history.length === 0) {
    console.log('history.json が空です。先に collect.js を実行してください。');
    return;
  }

  const state = loadJson(STATE_FILE, {
    lastMonthReport: null,
    lastQuarterReport: null,
    lastHalfReport: null,
    lastYearReport: null,
    firstDate: history[0].date,
  });

  const { latestDate, report } = generate(history, state);
  saveJson(STATE_FILE, state);

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const reportPath = path.join(REPORTS_DIR, `${latestDate}_report.md`);
  fs.writeFileSync(reportPath, report, 'utf-8');
  fs.writeFileSync(path.join(REPORTS_DIR, 'latest.md'), report, 'utf-8');
  console.log(`レポート生成完了: ${reportPath}`);
}

if (require.main === module) {
  main();
}

module.exports = { generate, buildRows, findPast, repValue, PERIODS };
