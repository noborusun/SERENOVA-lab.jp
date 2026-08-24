# Polymarket 週次スクリーンショット自動化

Polymarket(日本語版)の「人気上昇中」ページを、毎週月曜9時(JST)に自動で
9:16(1080×1920)サイズのスクリーンショットとして撮影し、リポジトリにコミットします。

## SERENOVA-lab.jp リポジトリへの組み込み手順

1. `SERENOVA-lab.jp` リポジトリの直下に、このフォルダの中身をそのままコピーする
   - `.github/workflows/weekly-screenshot.yml`
   - `scripts/capture.js`
2. GitHubにpushする(これだけでOK。npm installなどの事前準備は不要)
3. 動作確認したい場合:
   - GitHubのリポジトリページ →「Actions」タブ →
     「Weekly Polymarket Screenshot」を選択 →「Run workflow」で即実行できる
4. 実行が終わると、リポジトリの `screenshots/` フォルダに
   `polymarket_20260824.png`(撮影日付入り)と `latest.png`(常に最新版)が
   自動でコミットされる

## 動画編集時の使い方

毎回 `screenshots/latest.png` を開けば、直近の「人気上昇中」の最新スクリーンショットが
得られます。過去の履歴を見たい場合は `polymarket_YYYYMMDD.png` の日付入りファイルを
遡って探してください。

## カスタマイズ

- **撮影する曜日・時間を変えたい** → `.github/workflows/weekly-screenshot.yml` の
  `cron: '0 0 * * 1'` を変更(UTC基準。JSTはUTC+9なので、JST9時にしたい場合は `0 0`)
- **撮影するページを変えたい**(例: 財務カテゴリだけにしたい) →
  `scripts/capture.js` の `TARGET_URL` を変更
  (例: `https://polymarket.com/ja/finance`)
- **画像サイズを変えたい** → `scripts/capture.js` の `VIEWPORT` を変更

## 費用について

GitHub Actionsは、パブリックリポジトリなら完全無料、プライベートリポジトリでも
月2,000分まで無料枠があります。この処理は1回あたり1〜2分程度なので、週1回の実行なら
無料枠内に余裕で収まります。追加費用は発生しません。
