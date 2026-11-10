// SERENOVAお天気予報：さいたま市大宮。実行 node scripts/make_weather.js （Node 20+）
// 出力 weather/data.json（詳細）, weather/latest.json（LP一行用）
// 気象データ: Open-Meteo（無料枠は非商用のみ。商用プラン契約後は環境変数 OPEN_METEO_KEY を設定）
const fs = require('fs');
const KEY = process.env.OPEN_METEO_KEY || '';
const U = (sub, path) => `https://${KEY ? 'customer-' : ''}${sub}.open-meteo.com/v1/${path}${KEY ? '&apikey=' + KEY : ''}`;
const get = async u => { const r = await fetch(u); if (!r.ok) throw new Error(r.status + ' ' + u); return r.json(); };
const LAT = 35.906, LON = 139.624, TZ = 'timezone=Asia/Tokyo';
const NORM = [9.8, 10.9, 14, 19, 23.6, 25.9, 29.6, 31.4, 27.7, 22.1, 16.9, 12.1]; // 平年最高気温の目安（東京）
const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
const r1 = x => Math.round(x * 10) / 10;

(async () => {
  const HV = ['pressure_msl', 'relative_humidity_2m', 'temperature_850hPa', 'geopotential_height_900hPa',
    'geopotential_height_700hPa', 'relative_humidity_700hPa', 'wind_direction_900hPa'];
  const f = await get(U('api', `forecast?latitude=${LAT}&longitude=${LON}&${TZ}&past_days=1&forecast_days=16` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,sunshine_duration&hourly=${HV.join()}`));
  const LATS = [30, 34, 38, 42, 46];
  const J = await get(U('api', `forecast?latitude=${LATS}&longitude=${LATS.map(() => 140)}&${TZ}&past_days=1&forecast_days=16&hourly=wind_speed_250hPa`));
  const M = await get(U('marine-api', `marine?latitude=34,38&longitude=140,135&${TZ}&past_days=30&forecast_days=1&hourly=sea_surface_temperature`)).catch(() => null);
  const A = await get(U('air-quality-api', `air-quality?latitude=${LAT}&longitude=${LON}&${TZ}&forecast_days=5&hourly=dust`)).catch(() => null);

  const h = f.hourly, d = f.daily, noon = (a, i) => a[24 * i + 12];
  const days = [];
  for (let i = 1; i < d.time.length; i++) {
    const day = h.pressure_msl.slice(24 * i, 24 * i + 24);
    const drops = day.map((p, k) => p - h.pressure_msl[24 * i + k - 24]);
    const drop = Math.max(0, -Math.min(...drops)), rng = Math.max(...day) - Math.min(...day);
    const lv = drop >= 10 || rng >= 12 ? 3 : drop >= 6 || rng >= 8 ? 2 : drop >= 4 || rng >= 5 ? 1 : 0;
    const code = d.weather_code[i], pr = d.precipitation_sum[i] || 0, sun = d.sunshine_duration[i] || 0;
    const cls = [71, 73, 75, 77, 85, 86].includes(code) ? '雪' : pr >= 1 ? '雨' : sun < 4 * 3600 ? '曇' : '晴';
    const jl = LATS.map((_, k) => noon(J[k].hourly.wind_speed_250hPa, i));
    const jk = jl.indexOf(Math.max(...jl));
    days.push({
      date: d.time[i], cls, code, tmax: d.temperature_2m_max[i], tmin: d.temperature_2m_min[i], pr: r1(pr),
      sun: r1(sun / 3600), rh: Math.round(avg(h.relative_humidity_2m.slice(24 * i, 24 * i + 24))),
      rh7: noon(h.relative_humidity_700hPa, i), z9: Math.round(noon(h.geopotential_height_900hPa, i)),
      z7: Math.round(noon(h.geopotential_height_700hPa, i)), t850: r1(noon(h.temperature_850hPa, i)),
      wd: noon(h.wind_direction_900hPa, i), jet: LATS[jk], jspd: Math.round(jl[jk] / 3.6),
      auto: { lv, drop: r1(drop), rng: r1(rng) },
    });
  }

  // ---- なぜ（理由）の生成 ----
  days.forEach((x, i) => {
    const mo = +x.date.slice(5, 7), S = x.wd >= 90 && x.wd < 270, N = x.wd >= 270 || x.wd < 60, z7a = x.z7 - 3012;
    let run = 1; while (days[i + run] && days[i + run].cls === x.cls) run++;
    const nxt = days[i + run];
    const w = [];
    if (x.cls === '雨' || x.cls === '雪') {
      if (S) w.push('南寄りの風が湿った空気を運び込み');
      if (x.rh7 >= 70) w.push('上空3000mまで湿って雲が厚く発達しやすく');
      if (z7a < -25) w.push('上空に気圧の谷が近づいて上昇気流が強まり');
      if (x.jet <= 37) w.push('偏西風が関東付近を通って低気圧が通過しやすい配置で');
      if (x.cls === '雪' || x.t850 < -3) w.push('上空1500m付近に冷たい空気があり');
    } else if (x.cls === '晴') {
      if (z7a > 10) w.push('上空3000mに高気圧が張り出し、下降気流で雲が消えやすく');
      if (N) w.push('北〜北西の乾いた風が入り');
      if (x.rh7 < 40) w.push('上空まで空気が乾いていて');
    } else {
      if (x.rh7 >= 55) w.push('上空に湿った層が残って雲が居座り');
      if (S) w.push('南風で湿り気が入る一方、雨にするほどの上昇気流はなく');
    }
    const base = w.length ? w.join('、').replace(/、?$/, '') : '強い高低気圧に支配されず、弱い気圧配置で雲が出入りして';
    const cause = base + (x.cls === '雨' ? '、雨になります。' : x.cls === '雪' ? '、雪になりやすい日です。' : x.cls === '晴' ? '、晴れます。' : '、すっきりしない空です。');
    const diff = r1(x.tmax - NORM[mo - 1]);
    let tw = '';
    if (diff >= 3) tw = `最高気温は平年より約${diff}℃高め。${S ? '南からの暖かい空気' : z7a > 10 ? '上空の高気圧による強い日射' : '暖気の流入'}が理由です。`;
    else if (diff <= -3) tw = `最高気温は平年より約${-diff}℃低め。${N ? '北からの冷たい風' : x.t850 < 3 ? '上空の寒気' : '日射不足'}が理由です。`;
    const cont = run >= 2 ? `この${x.cls}は約${run}日続く見込み` + (nxt ? `。${nxt.date.slice(5).replace('-', '/')}ごろ${nxt.cls}に変わる流れです。` : '（予報期間の終わりまで）。') : '';
    x.why = cause + tw + cont; x.anom = diff;
  });

  // ---- 季節アラート（今日〜3日先） ----
  const rules = [
    [x => (x.tmax + x.tmin) / 2 >= 20 && x.rh >= 70, '🍄 カビ・湿気', '押入れ・浴室の換気と除湿を。エアコンのドライ運転や、タンスの扉を開けて空気を動かすのが効果的です。'],
    [x => x.tmax >= 25 && x.rh >= 65, '🍱 食品保存', '作り置きは粗熱をとってすぐ冷蔵。弁当には保冷剤を。常温放置は2時間以内が目安です。'],
    [x => [10, 11].includes(+x.date.slice(5, 7)) && x.tmax >= 14 && x.cls === '晴', '🪲 カメムシ', '暖かい晴れの日は越冬場所を探して家に寄ってきます。洗濯物は取り込む前にはらい、網戸・窓のすき間を点検。潰すと臭うので掃除機かガムテープで。'],
    [x => (+x.date.slice(5, 7) >= 11 || +x.date.slice(5, 7) <= 3) && x.rh < 50, '🔥 乾燥・火の元', '加湿と水分補給を。空気が乾くと火災・ウイルスの生存に有利です。'],
    [x => (+x.date.slice(5, 7) >= 11 || +x.date.slice(5, 7) <= 3) && x.tmin <= 8 && x.rh >= 65, '💧 結露', '窓・北側の壁の結露はカビのもと。朝に拭き取り、短時間の換気を。'],
    [x => x.tmax >= 33, '🥵 熱中症', 'こまめな水分・塩分と室温管理を。'],
    [x => x.tmin <= 2, '🧊 冷え込み・ヒートショック', '浴室・脱衣所を事前に温め、水道管の凍結にも注意を。'],
  ];
  const alerts = [], seen = new Set();
  days.slice(0, 3).forEach((x, i) => rules.forEach(([fn, t, b]) => {
    if (!seen.has(t) && fn(x)) { seen.add(t); alerts.push({ title: t, body: b, from: x.date }); }
  }));

  // ---- 海洋・黄砂 ----
  let sst = [];
  if (M) {
    const Ms = Array.isArray(M) ? M : [M], names = ['黒潮域（房総沖）', '日本海（能登沖）'];
    sst = Ms.map((m, k) => {
      const v = m.hourly.sea_surface_temperature, now = v[30 * 24 + 12], ago = v[12];
      return { name: names[k], now: now == null ? null : r1(now), d30: now == null || ago == null ? null : r1(now - ago) };
    });
  }
  let dust = null;
  if (A) dust = Math.round(Math.max(...A.hourly.dust.filter(v => v != null), 0));

  const t = days[0], L = ['安全', 'やや注意', '注意', '警戒'][t.auto.lv];
  const wk = '日月火水木金土'[new Date(t.date + 'T12:00:00Z').getUTCDay()];
  const md = `${+t.date.slice(5, 7)}/${+t.date.slice(8)}(${wk})`;
  const out = {
    updated: new Date().toISOString(), place: 'さいたま市大宮', days, alerts,
    analysis: { sst, dust, jet: { lat: t.jet, spd: t.jspd }, z9: t.z9, z7: t.z7, t850: t.t850 },
  };
  fs.mkdirSync('weather', { recursive: true });
  fs.writeFileSync('weather/data.json', JSON.stringify(out));
  fs.writeFileSync('weather/latest.json', JSON.stringify({
    date: t.date, line: `${md} 大宮 ${t.cls} ${Math.round(t.tmax)}℃/${Math.round(t.tmin)}℃｜自律神経 ${L}｜${t.why.split('。')[0]}`,
  }));
  console.log('ok', md, t.cls, L);
})().catch(e => { console.error(e); process.exit(1); });
