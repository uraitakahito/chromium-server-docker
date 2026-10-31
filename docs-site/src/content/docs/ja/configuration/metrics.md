---
title: メトリクス
description: イメージに同梱した 2 つの Prometheus exporter、:9100 と :9256 で何が出るか、scrape と確認の方法。
---

production イメージには上流の Prometheus exporter を 2 つ同梱してある。配備先ごとに
agent を入れなくても、コンテナの**中**の状態を scrape できるようにするためだ。どちらも
Chromium・`socat` と並ぶ `supervisord` の program として動く。

| ポート | program | 出るもの |
| --- | --- | --- |
| `9100` | [node_exporter](https://github.com/prometheus/node_exporter) 1.12.1 | VM / OS の値: `cpu`・`meminfo`・`loadavg`・`filesystem`・`netdev`・`processes`（collector は opt-in。ほかは全部無効） |
| `9256` | [process-exporter](https://github.com/ncabatoff/process-exporter) 0.8.7 | process の群ごとの CPU・RSS・thread・fd。Chromium の `--type=` で群に分ける（`namedprocess_namegroup_*`） |

このイメージを使う compose は、どちらのポートも host に publish しない。**コンテナの
network の中から**、コンテナの DNS 名で scrape する前提である（例:
`chromium-1.capture-ledger:9256`）。`9222`（socat 経由の CDP）は変わらない。

## process の群

群はリポジトリの root の `process-exporter.yml` で決める。先に当たった規則が勝つので、
`--type=` の規則を親の browser process より前に置いてある:

| `groupname` | 当たるもの |
| --- | --- |
| `chromium-renderer`・`chromium-gpu-process`・`chromium-utility`・`chromium-zygote` … | `--type=<type>` を持つ `chromium` の process |
| `chromium-browser` | 親の `chromium` の process（`--type` 無し） |
| `chrome_crashpad` | crashpad handler |
| `supervisord`・`socat` | ほかの 2 つの常駐 program |

catch-all の規則は意図して置いていない。`{{.Comm}}` と `.+` を置くと、scrape の間に
生まれる `sh` や `curl` が 1 つずつ群になり、series が膨れる。どの規則にも当たらない
process（`dbus-run-session`・`dbus-daemon`・起動 script）は数えない（`-children=false`）。

親は path ではなく `comm` で当てている。process-exporter は process を最初に見たときに
群を決めて、その pid の間は変えない。Chromium は Debian の `/usr/bin/chromium` wrapper
から起動し、wrapper が同じ pid で本物の binary を `exec()` するので、Chromium と同時に
起動した exporter は wrapper を先に見る。`/usr/lib/chromium/chromium` に anchor した規則は
それを取りこぼし続けるが、`comm` は wrapper でも binary でも `chromium` である。

よく使う series:

```
namedprocess_namegroup_num_procs{groupname="chromium-renderer"}
namedprocess_namegroup_memory_bytes{groupname="chromium-browser",memtype="resident"}
namedprocess_namegroup_cpu_seconds_total{groupname="chromium-utility",mode="user"}
namedprocess_namegroup_open_filedesc{groupname="chromium-browser"}
```

## scrape

同じコンテナ network の中で動く Prometheus なら:

```yaml
scrape_configs:
  - job_name: chromium-node
    static_configs: [{ targets: ["chromium-1.capture-ledger:9100", "chromium-2.capture-ledger:9100"] }]
  - job_name: chromium-process
    static_configs: [{ targets: ["chromium-1.capture-ledger:9256", "chromium-2.capture-ledger:9256"] }]
```

## 確認

host からは exporter のポートに届かない（publish していない）ので、コンテナ自身に訊く:

```sh
container exec chromium-1 sh -c 'curl -sf localhost:9100/metrics | grep -c -v "^#"'
container exec chromium-1 sh -c 'curl -sf localhost:9256/metrics | grep namedprocess_namegroup_num_procs'
container exec chromium-1 supervisorctl -c /etc/supervisor/conf.d/app.conf status
```

期待する答え: `chromium-browser` が `1`、`chromium-renderer` が在る、4 つの program
（`chromium`・`socat`・`node-exporter`・`process-exporter`）が全部 `RUNNING`。CI の
smoke job は amd64 のイメージに対して Docker で同じ 3 つを確かめる。

## node_exporter の読み方

`node_exporter` は、自分が乗っている kernel が見ているものを報告する:

- **Apple Container** では 1 コンテナが 1 つの軽い VM なので、`node_memory_*`・
  `node_cpu_*`・`node_filesystem_*` はその VM の値になる: 4 GiB の memory の枠、VM の
  root disk、その `eth0`。
- **Docker**（kernel 共有）では同じ series が**コンテナではなく host**を表す。そこでは
  コンテナ単位の資源は cAdvisor か runtime 自身の stats で取り、`node_exporter` は
  host の文脈として読む。

`process-exporter` にこの曖昧さは無い。コンテナの PID namespace に属する `/proc` の
entry だけを読む。

## exporter の版を上げる

Dependabot は GitHub の release asset を追わないので、上げるのは手作業になる:

1. release を選び、その checksum ファイルを取る（node_exporter は `sha256sums.txt`、
   process-exporter は `checksums.txt`）。
2. `docker/exporters.sha256` の 4 行を置き換える（両 exporter の `linux-amd64` と
   `linux-arm64`）。
3. `docker/Dockerfile` の `ARG NODE_EXPORTER_VERSION` / `ARG PROCESS_EXPORTER_VERSION`
   の既定値を変える。
4. build する。古い、または綴りを間違えた checksum は `exporters` stage で
   `sha256sum: WARNING: 1 computed checksum did NOT match` として落ちる。
