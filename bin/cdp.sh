#!/bin/bash
#
# cdp.sh —— 手早く確かめるための、依存ゼロの CDP の helper。
#
# Node の組み込みの fetch と WebSocket（Node 22 以上）だけで、
# chromium-server の worker と Chrome DevTools Protocol で話す。
# npm install も、使い捨てのスクリプトも要らない。
#
#   ./bin/cdp.sh smoke [url]     # 版を出し、ページを開き、題を出す
#   ./bin/cdp.sh goto <url>      # 遷移して load イベントを待つ
#   ./bin/cdp.sh title           # document.title を出す
#   ./bin/cdp.sh eval <expr>     # JS の式を評価して結果を出す
#   ./bin/cdp.sh shot <file.png> # ページのスクリーンショットを保存する
#   ./bin/cdp.sh targets         # 開いている tab の一覧（url と title）
#
# worker の選び方: $CDP_TARGET（worker の名前）、無ければ compose のスタックの worker
# （chromium.chromium-server。127.0.0.1:9222 に publish した口から繋ぐ）、
# 無ければ chromium-1、chromium-* の順で最初の物。
# 失敗すると 0 以外で終わるので、そのまま自動の smoke の確かめに使える。
#
set -euo pipefail
CMD="${1:-help}"; shift || true

# --- worker を決める: CDP_TARGET -> chromium.chromium-server -> chromium-1 -> 最初の chromium-* ---
# （attic/debug を復活させた chromium-debug という worker も、最後の chromium-* で当たる）
NAME="${CDP_TARGET:-}"
if [ -z "$NAME" ]; then
    NAME=$(container ls --format json | python3 -c '
import json, sys
ids = [c.get("configuration", {}).get("id", "") for c in json.load(sys.stdin)]
if "chromium.chromium-server" in ids:
    print("chromium.chromium-server")
elif "chromium-1" in ids:
    print("chromium-1")
else:
    workers = [i for i in ids if i.startswith("chromium-")]
    print(workers[0] if workers else "")')
fi
if [ -z "$NAME" ]; then
    echo "error: no chromium worker running (start the stack: ./bin/stack.sh up)" >&2
    exit 1
fi

# --- 繋ぎ先を決める ---
# compose のスタックは、CDP を host の loopback（127.0.0.1:9222）に publish する。
# それ以外は、コンテナ自身の IP の 9222 の口に繋ぐ。
PORT=9222
if [ "$NAME" = "chromium.chromium-server" ]; then
    IP=127.0.0.1
elif ! IP=$(container inspect "$NAME" 2>/dev/null | python3 -c 'import json, sys
d = json.load(sys.stdin); d = d[0] if isinstance(d, list) else d
print(d["status"]["networks"][0]["ipv4Address"].split("/")[0])' 2>/dev/null) || [ -z "$IP" ]; then
    echo "error: worker \"${NAME}\" not found or not running (check: container ls)" >&2
    exit 1
fi

# --- CDP の本体: Node の組み込みの fetch と WebSocket（依存ゼロ） ---
# 埋め込みの JS に一重引用符を書いてはいけない（ここで一重引用符で囲っている）。
# shellcheck disable=SC2016  # 下の ${...} は JS のテンプレートリテラルで、シェルの物ではない
NAME="$NAME" exec node --input-type=module -e '
const [ip, port, cmd, ...args] = process.argv.slice(1);
const base = `http://${ip}:${port}`;
const j = async (p, o) => (await fetch(base + p, o)).json();

const usage = "usage: cdp.sh smoke [url] | goto URL | title | eval EXPR | shot FILE.png | targets";
if (cmd === "help" || cmd === "--help" || cmd === "-h") { console.log(usage); process.exit(0); }

try {
  if (cmd === "targets") {           // HTTP だけで済む。WebSocket は要らない
    for (const t of await j("/json/list"))
      if (t.type === "page") console.log(`${t.url}\t${t.title}`);
    process.exit(0);
  }

  // page の target を確保する: 開いている最初の tab を使い回し、無いときだけ作る。
  // いまの Chromium の PUT /json/new は url= の引数を無視する（実測）が、tab を作るだけなら動く。
  const page = (await j("/json/list")).find(t => t.type === "page")
            ?? await j("/json/new", { method: "PUT" });

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, ng) => {
    ws.onopen = ok;
    ws.onerror = () => ng(new Error(`cannot connect to ${page.webSocketDebuggerUrl}`));
  });
  // watchdog: 詰まった接続で CLI が永久に止まらないようにする。
  // 正常な終了を遅らせないように unref する。
  setTimeout(() => { console.error("error: CDP call timed out"); process.exit(1); }, 30000).unref();

  let seq = 0;
  const pending = new Map(), waiters = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method && waiters.has(m.method)) { waiters.get(m.method)(); waiters.delete(m.method); }
  };
  const call = (method, params = {}) =>
    new Promise(ok => { pending.set(++seq, ok); ws.send(JSON.stringify({ id: seq, method, params })); });
  const once = (method, ms) => Promise.race([
    new Promise(ok => waiters.set(method, ok)),
    new Promise((_, ng) => setTimeout(() => ng(new Error(`timeout waiting for ${method}`)), ms)),
  ]);
  const goto = async (url) => {       // 決め打ちの sleep ではなく、load イベントを待つ
    await call("Page.enable");
    const loaded = once("Page.loadEventFired", 15000);
    const nav = await call("Page.navigate", { url });
    // Chromium は DNS や接続の失敗でも、エラーのページを読み込んで「成功」する。
    // 本当の結果は、navigate の応答の errorText に在る。
    if (nav.errorText) throw new Error(`navigation failed: ${nav.errorText}`);
    await loaded;
  };
  const evaljs = async (expr) =>
    (await call("Runtime.evaluate", { expression: expr, returnByValue: true })).result.value;

  if (cmd === "goto") {
    await goto(args[0]);
    console.log("loaded:", await evaljs("location.href"));
  } else if (cmd === "title") {
    console.log(JSON.stringify(await evaljs("document.title")));
  } else if (cmd === "eval") {
    console.log(await evaljs(args[0]));
  } else if (cmd === "shot") {
    const { data } = await call("Page.captureScreenshot");
    (await import("node:fs")).writeFileSync(args[0], Buffer.from(data, "base64"));
    console.log(`saved: ${args[0]}`);
  } else if (cmd === "smoke") {
    const v = await j("/json/version");
    console.log(`${process.env.NAME} (${ip}): ${v.Browser}`);
    // 既定は、いつも内容が変わる本物のページにする:
    // example.com のような静的なページでは、実際に中身を取れていることを示せない。
    const url = args[0] ?? "https://www.yahoo.co.jp/";
    try {
      await goto(url);
    } catch (e) {
      // 起動した直後の worker の VM は、ネットワークが落ち着くまで、最初の要求を落とすことがある
      // （net::ERR_NETWORK_CHANGED）。見える形で 1 回だけやり直す。
      console.error(`first attempt failed (${e.message}), retrying once...`);
      await new Promise(r => setTimeout(r, 2000));
      await goto(url);
    }
    console.log("title:", JSON.stringify(await evaljs("document.title")));
  } else {
    console.error(usage);
    process.exit(2);
  }
  ws.close();
} catch (e) {
  console.error("error:", e.message);
  process.exit(1);
}
' -- "$IP" "$PORT" "$CMD" "$@"
