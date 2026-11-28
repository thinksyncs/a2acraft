# 富山市内電車の運行シミュレーター

A2ACraft のメニューで「富山市内電車」を選ぶと、南富山駅前から大町を経由して堀川小泉に至る軌道と、停留場別の時刻表が開きます。再生ボタンで仮想車両が走ります。「出発の遅れ」と「区間所要時間」を変更すると、元の時刻表を残したまま仮想車両の運行を変更できます。

「記録再生」は2026年11月28日の時刻表を使います。初期選択の16時20分発には、16:21:19から16:25:00（日本時間）までに観測された6点の車両位置を収録しています。それぞれの観測時刻に達すると、その位置を表示します。記録がない便でも、仮想車両を走らせられます。

「ライブ」はサーバー経由で配信元の車両位置を取得し、日本時間の運行日と便IDで時刻表と照合します。通信が途切れた場合は、画面に取得状況が表示されます。オフラインのデスクトップデモでは「記録再生」を使用できます。

## 公開データと更新

富山地方鉄道が配布している静的GTFSから3停留場の時刻表と軌道形状を抽出し、GTFS RealtimeのVehiclePositionsから観測時刻・緯度・経度を読み取ります。配布ライセンスはCC0 1.0です。[データカタログ](https://gtfs-data.jp/search?target_feed=chitetsu%2Achitetsushinaidensha)

同梱のライブ用時刻表の有効期間は2026年3月14日〜2027年3月13日です。ダイヤ改正時は、リポジトリのルートで次のコマンドを実行して更新します。

```sh
curl -fL 'https://api.gtfs-data.jp/v2/organizations/chitetsu/feeds/chitetsushinaidensha/files/feed.zip?rid=current' -o /tmp/toyama-gtfs.zip
python3 scripts/toyama-tram/generate_service.py /tmp/toyama-gtfs.zip public/toyama-tram/data/service.json
```

記録を作り直すには、対象便の運行中に [車両位置フィード](https://gtfs-rt-files.buscatch.jp/toyama/chitetsu_tram/VehiclePositions.pb) を異なる時刻に複数保存し、同じ運行日に有効な静的GTFSと組み合わせます。

```sh
python3 scripts/toyama-tram/make_sample.py --schedule /tmp/toyama-gtfs.zip \
  --date YYYY-MM-DD --trip '対象便のtrip_id' /path/to/snapshots/*.pb
python3 -m unittest discover -s scripts/toyama-tram -p 'test_*.py'
npm test
```
