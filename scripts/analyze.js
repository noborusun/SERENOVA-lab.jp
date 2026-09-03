// 哨戒班(しょうかいはん) - 分析・比較コメント生成スクリプト
// collect.js が溜めた data/history.json を読み、
// 週/月/3か月/6か月/年 の周期ごとに比較コメントを作り、
// note にそのまま貼れる Markdown レポートを reports/ に出力する。
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

// oddsの配列から「代表確率」を1つ選ぶ(最大値=一番注目されている選択肢とみなす簡易ヒューリスティック)
function leadingOdd(record) {
  if (!record || !record.odds || record.odds.length === 0) return null;
  const nums = record.odds.map((s) => parseFloat(s)).filter((n) => !isNaN(n));
  if (nums.length === 0) return null;
  return Math.max(...nums);
}

function daysBetween(d1, d2) {
  return Math.abs((new Date(d1) - new Date(d2)) / (1000 * 60 * 60 * 24));
}

// 指定日付に一番近い過去のレコード(そのマーケットについて)を探す
function findNearestPast(history, slug, targetDate, toleranceDays) {
  const candidates = history.filter((h) => h.slug === slug && new Date(h.date) < new Date(targetDate));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => new Date(b.date) - new Date(a.date));
  const nearest = candidates[0];
  if (toleranceDays && daysBetween(nearest.date, targetDate) > toleranceDays) return null;
  return nearest;
}

function buildComparisonRow(history, targets, targetDate, compareDate, toleranceDays) {
  // targets: そのマーケットのユニーク一覧(label, slug)
  return targets.map((t) => {
    const current = history.find((h) => h.slug === t.slug && h.date === targetDate);
    const past = findNearestPast(history, t.slug, targetDate, toleranceDays) || null;

    const curOdd = leadingOdd(current);
    const pastOdd = leadingOdd(past);

    let comment = 'データ不足';
    if (current && current.odds.length === 0 && current.status === 'ok') {
      comment = '⚠️ 賞味期限切れの可能性(イベント終了などでデータ取得できず、収集対象からの除外を検討)';
    } else if (curOdd !== null && pastOdd !== null) {
      const diff = curOdd - pastOdd;
      if (Math.abs(diff) >= BIG_CHANGE_THRESHOLD) {
        comment = `大きな変化: ${diff > 0 ? '+' : ''}${diff.toFixed(1)}pt`;
      } else {
        comment = '前回と同様の動き';
      }
    } else if (curOdd !== null && pastOdd === null) {
      comment = '比較対象データなし(初回収集扱い)';
    }

    return {
      label: t.label,
      current: curOdd !== null ? `${curOdd}%` : '取得不可',
      past: pastOdd !== null ? `${pastOdd}%` : '-',
      comment,
    };
  });
}

function toMarkdownTable(rows) {
  const header = `| 項目 | 前回 | 今回 | 変化・コメント |\n|---|---|---|---|\n`;
  const body = rows.map((r) => `| ${r.label} | ${r.past} | ${r.current} | ${r.comment} |`).join('\n');
  return header + body;
}

function monthsBetween(d1, d2) {
  const a = new Date(d1);
  const b = new Date(d2);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

(async () => {
  const history = loadJson(DATA_FILE, []);
  if (history.length === 0) {
    console.log('history.json が空です。先に collect.js を実行してください。');
    return;
  }

  const state = loadJson(STATE_FILE, {
    lastMonthReport: null, // 'YYYY-MM'
    lastQuarterReport: null,
    lastHalfReport: null,
    lastYearReport: null,
    firstDate: history[0].date,
  });

  const latestDate = history[history.length - 1].date;
  const targets = [...new Map(history.map((h) => [h.slug, { slug: h.slug, label: h.label }])).values()];

  fs.mkdirSync(REPORTS_DIR, { recursive: true });

  const sections = [];

  // --- 週次レポート(毎回生成) ---
  const weekRows = buildComparisonRow(history, targets, latestDate, latestDate, 9); // 直近9日以内の過去データと比較
  sections.push(`## 📅 週次比較(${latestDate}時点)\n\n${toMarkdownTable(weekRows)}\n`);

  // --- 月次レポート(月が変わった最初の実行時のみ) ---
  const thisMonthKey = latestDate.slice(0, 7); // YYYY-MM
  if (state.lastMonthReport !== thisMonthKey) {
    const monthRows = buildComparisonRow(history, targets, latestDate, latestDate, 40);
    sections.push(`## 🗓️ 月次比較(${thisMonthKey})\n\n${toMarkdownTable(monthRows)}\n`);
    state.lastMonthReport = thisMonthKey;
  }

  // --- 3か月/6か月/年次: 起点からの経過月数で判定 ---
  const elapsedMonths = monthsBetween(state.firstDate, latestDate);

  if (elapsedMonths > 0 && elapsedMonths % 3 === 0 && state.lastQuarterReport !== thisMonthKey) {
    const qRows = buildComparisonRow(history, targets, latestDate, latestDate, 100);
    sections.push(`## 📊 3か月(四半期)比較(${thisMonthKey})\n\n${toMarkdownTable(qRows)}\n`);
    state.lastQuarterReport = thisMonthKey;
  }

  if (elapsedMonths > 0 && elapsedMonths % 6 === 0 && state.lastHalfReport !== thisMonthKey) {
    const hRows = buildComparisonRow(history, targets, latestDate, latestDate, 190);
    sections.push(`## 📈 半期比較(${thisMonthKey})\n\n${toMarkdownTable(hRows)}\n`);
    state.lastHalfReport = thisMonthKey;
  }

  if (elapsedMonths > 0 && elapsedMonths % 12 === 0 && state.lastYearReport !== thisMonthKey) {
    const yRows = buildComparisonRow(history, targets, latestDate, latestDate, 380);
    sections.push(`## 🏆 年次比較(${thisMonthKey})\n\n${toMarkdownTable(yRows)}\n`);
    state.lastYearReport = thisMonthKey;
  }

  saveJson(STATE_FILE, state);

  const report = [
    `# 哨戒班レポート ${latestDate}`,
    '',
    '※本レポートはPolymarket(予測市場)の確率データを機械的に収集・比較したものです。特定の投資判断を推奨するものではありません。',
    '',
    ...sections,
  ].join('\n');

  const reportPath = path.join(REPORTS_DIR, `${latestDate}_report.md`);
  fs.writeFileSync(reportPath, report, 'utf-8');
  // note貼り付け用に「最新版」も常に同じファイル名で残す
  fs.writeFileSync(path.join(REPORTS_DIR, 'latest.md'), report, 'utf-8');

  console.log(`レポート生成完了: ${reportPath}`);
})();

