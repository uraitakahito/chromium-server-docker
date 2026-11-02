---
title: Chromium の版
description: image が Chromium とほかの apt の package をどう固定しているか、動いている版の見方、固定の上げ方。
---

image は Debian の `chromium`（安定版）を入れる。どの build が入るかは、
[`docker/Dockerfile`](https://github.com/uraitakahito/chromium-server-docker/blob/main/docker/Dockerfile)
の 2 つの値で決まる:

| 値 | 決めるもの |
| --- | --- |
| `ARG CHROMIUM_VERSION` | `chromium`・`chromium-common`・`chromium-sandbox` の Debian の版。install がこの版を名指すので、その版を持たない snapshot では build が落ちる。 |
| `ARG APT_SNAPSHOT` | apt が**全部の** package を読む [snapshot.debian.org](https://snapshot.debian.org/) の時点。fonts・`dbus`・`supervisor`・`socat`・`curl`・`ca-certificates` もここから入る。 |

だから image を建て直しても、毎回同じ版の package が入る。arch が違っても同じである
（Apple Container では arm64、CI では amd64）。base image の digest が固定するのは base
image だけで、apt は deb.debian.org ではなく snapshot を読む。

## 動いている版を見る

```sh
curl -s http://localhost:9222/json/version                 # "Browser": "Chrome/<上流の版>"
container image inspect chromium-server:production         # label の …chromium-version と …apt-snapshot
```

`<上流の版>` は、`CHROMIUM_VERSION` から Debian の revision を除いたもの
（`156.0.8078.73-1~deb12u1` → `156.0.8078.73`）。この 2 つを照らす点検は 3 つある:

- CI の smoke test。arm64 と amd64 の両方で、`dpkg` の版も見る
- [監視スタック](/ja/getting-started/monitoring/)の `./bin/check-stack.mjs`
- BrowserHive のスタックの点検。worker ごとに見る

食い違ったら、そのコンテナは固定より前に建てた image で動いている。建て直す。

## base image の日付で固定しない理由

base image（`debian:bookworm-<YYYYMMDD>-slim`）そのものが、その日付の
snapshot.debian.org から作られていて、その時点を
`/etc/apt/sources.list.d/debian.sources` に書いている。package も同じ時点から読むのが
素直に見える。だが、新しい base image が出るのは 1〜5 週おきで、Debian の chromium の更新は
ほぼ毎週来る。2026-10-27 の base の時点の snapshot にあったのは `156.0.8078.47` で、
`156.0.8078.73` はその 2 日後に archive に入った。

だから `APT_SNAPSHOT` は別の値として持つ。最初の `RUN` が断るのは、base の時点より
**前**の時点だけである（前の時点だと、base の新しい package と古い package が混ざる）。

## 固定を上げる

```sh
node bin/pin-chromium.mjs                                   # いまの固定と、最新の版
node bin/pin-chromium.mjs --write                           # 最新の版を docker/Dockerfile に書く
node bin/pin-chromium.mjs --write 156.0.8078.73-1~deb12u1   # 版を名指して書く
```

helper には Node 22 以上と、`PATH` の上の `xz` が要る。snapshot.debian.org に次の 2 つを訊く:

1. base image の codename の最新の chromium（bookworm なら `~deb12u…`）。版を名指したときはその版
2. その版が amd64 と arm64 の**両方**の索引に載っている、いちばん早い debian-security の取り込み。
   ただし base の時点より前ではないもの

Debian に上がった直後は、arch によって版が食い違うことがある。2026-10-29 の 18:00（UTC）には、
arm64 の索引はもう `156.0.8078.73` を載せていて、amd64 の索引はまだ `.47` だった。helper は、
package が archive に入った時刻だけでなく、索引そのものを確かめる。

固定を上げた後の最初の build は、全部の package を snapshot.debian.org から取る。snapshot は
file を 1 つずつ配るので遅く、2026-11-02 には 223 MB に 5 分ほど掛かった。同じ固定の建て直しは、
snapshot の側の cache と build の cache が効いて数秒だった。

### Dependabot が base image を上げたとき

Dependabot は base image を毎週見る。上げるのは tag と digest だけで、2 つの `ARG` は
上げない。だからその pull request は build が落ちる:

```
APT_SNAPSHOT=… is earlier than the base image's snapshot …; run: node bin/pin-chromium.mjs --write
```

pull request の枝を checkout して `node bin/pin-chromium.mjs --write` を走らせ、
`docker/Dockerfile` を commit して push する。CI が両方の arch でもう 1 度建てる。Chromium も
同じ pull request で上がる。

### security の更新

固定していると、Chromium の security の更新は、固定を上げたときにしか image に入らない。
Debian の chromium は、上流から点の更新で 2 日ほど、新しい major の版で 1 週間ほど遅れて
出る。Debian に chromium の更新が出たら、helper を走らせる。新しい base image を待つ必要は
無い。

## ここで固定しないもの

- **exporter** は、自分の版の `ARG` と `docker/exporters.sha256` で固定している
  （[メトリクス](/ja/configuration/metrics/)を参照）
- **`attic/`** の Dockerfile は建てない。いまも、その日に apt が出す物を入れる
