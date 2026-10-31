---
title: 監視スタック
description: docker-compose.yml が worker と Prometheus・Grafana・blackbox を Apple Container に並べる。入口は bin/stack.sh の 1 本。
---

このリポジトリには、worker を **その metrics を読む道具と一緒に** 起こす開発スタックが
入っている。Prometheus がイメージに同梱した exporter（[メトリクス](/ja/configuration/metrics/)）
を scrape し、blackbox が CDP を probe し、Grafana が provisioning した dashboard を見せる。
全部 `docker-compose.yml` と `monitoring/` にあり、1 本の script で起こす。

| service | image | 届く先 |
| --- | --- | --- |
| `chromium` | `docker/Dockerfile` から build | `127.0.0.1:9222`（CDP。`bin/cdp.sh` が使う） |
| `prometheus` | `prom/prometheus:v3.15.1` | `127.0.0.1:9090` |
| `grafana` | `grafana/grafana:13.2.5` | `127.0.0.1:3000`（anonymous の Viewer） |
| `blackbox` | `prom/blackbox-exporter:v0.29.1` | stack の中だけ |

exporter のポート `9100`／`9256` は **publish しない**。Prometheus はコンテナ network の中で
`chromium.chromium-server:9100` と `:9256` として読む。

## マシンごとに 1 回

compose の project 名 `chromium-server` は DNS ドメインでもある。1 回だけ登録する（sudo が要る）:

```sh
sudo container system dns create chromium-server
```

無いと container-compose は黙って各コンテナの中の `/etc/hosts` を書く方式に落ち、非 root の
イメージでは失敗して、Prometheus が worker の名前を引けない。`bin/stack.sh up` はドメインが
在るまで起動を断る。

## 同時に起こすのは 1 つだけ

利用者の stack（capture-ledger・browserhive）は自分の chromium を同じ loopback の口に publish する。
この stack をそれらと並べて起こさない。先に他方を止める（そちらで `pnpm run dev:down`／`pnpm run stack:down`）。
`bin/stack.sh up` は `127.0.0.1:9222` を自分以外が持っている間は起動を断り、持ち主の候補を名指す。

## 起こす・確かめる・止める

```sh
./bin/stack.sh up       # preflight → container-compose up -d -b → 全部が答えるまで待つ
./bin/stack.sh check    # 同じ確認をもう一度（--wait で 60 秒まで待つ）
./bin/stack.sh reload   # Prometheus に prometheus.yml と rules を読み直させる
./bin/stack.sh down     # コンテナを止める（消すのは `container rm`）
```

`check` は 3 層を見る: publish した 3 つの口（3000・9090・9222）が答える、Prometheus の scrape target が全部 `up`、
worker の中の process-exporter が親の `chromium` を 1 本と数える。落ちた行を名指しして
非 0 で終わる。

そのあと Grafana <http://127.0.0.1:3000/d/chromium>（dashboard `chromium-server`。login は要らない）
と Prometheus <http://127.0.0.1:9090/targets> を開く。

## dashboard に在るもの

| panel | 式 | 読めること |
| --- | --- | --- |
| 生死 | `up{job=~"chromium-.*"}`・`probe_success` | exporter が答える・CDP が答える |
| process の群ごとの RSS | `namedprocess_namegroup_memory_bytes{memtype="resident"}` | memory を持っているのがどの群か（renderer・browser・utility…） |
| process の群ごとの CPU | `rate(namedprocess_namegroup_cpu_seconds_total[1m])` | 取り込みの重さ |
| process の数 | `namedprocess_namegroup_num_procs` | `chromium-browser` は常に 1。消えない renderer |
| VM の memory | `node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes` | 4 GiB の枠までの距離 |
| fd・disk・load・network | `namedprocess_namegroup_open_filedesc`・`node_filesystem_avail_bytes`・`node_load1`・`node_network_*` | VM の残り |

dashboard は `monitoring/grafana/dashboards/chromium.json` から provisioning し、UI では
読み取り専用（`allowUiUpdates: false`）。変えるときは UI で直して JSON を export し commit する。
Grafana は 30 秒以内に file を拾う。

## alert

`monitoring/prometheus/rules/chromium.yml` に 5 本。Prometheus が評価し、<http://127.0.0.1:9090/alerts>
と Grafana の Alerting で見える。この stack に Alertmanager は無い。どこへ届けるかは別の判断。

| alert | 条件 |
| --- | --- |
| `ChromiumCdpDown` | blackbox が `/json/version` から 2xx を 1 分得られない |
| `ChromiumBrowserMissing` | `chromium-browser` が 1 分間 1 でない |
| `ChromiumExporterDown` | `chromium-*` の scrape job が 2 分 down |
| `ChromiumRendererMemoryHigh` | renderer の RSS が 1.5 GB を 5 分超える |
| `ChromiumVmMemoryLow` | VM の空き memory が 512 MB を 5 分切る |

## なぜこの形か

- **Prometheus と Grafana の `user: "0"`。** Apple Container では named volume が root 所有
  （実測）。Grafana（uid 472）は `mkdir /var/lib/grafana/plugins: Permission denied` で止まり、
  Prometheus（nobody）は立たない。host の loopback にしか出ない開発の道具なので、VM の中で
  root で動かすのが現実的な直し方。
- **Prometheus の URL は provisioning の file に書く。`environment:` には書かない。**
  container-compose は service 名と同じ値の環境変数をその service の IP に黙って書き換えることがある。
- **`build.target` は無視される**（container-compose）。Dockerfile の最後の段が `production` なので
  同じイメージが建つ。
- **`container_name:` は書かない。** `<service>.chromium-server` の DNS 命名が抑止される。
- **blackbox の probe は `Host: localhost` を送る。** Chromium の DevTools の HTTP 口は、Host が
  IP か `localhost` でないと `500 Host header is specified and is not an IP address or localhost`
  を返す（DNS rebinding の守り）。DNS 名をそのまま使った probe は、CDP が生きているのに down と言っていた。

## scrape 設定をほかで使う

worker を複数台持つ stack（browserhive・capture-ledger）は、`monitoring/prometheus/prometheus.yml`
の `chromium-*` の job 2 つを写し、自分のコンテナ名（例 `chromium-1.browserhive:9100`）を並べればよい。
その Prometheus をどこに置くかは、その project の判断。
