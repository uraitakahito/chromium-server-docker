#!/bin/bash
#
# cdp.sh — zero-dependency CDP helper for quick verification.
#
# Talks to a chromium-server worker over the Chrome DevTools Protocol using
# nothing but Node's built-in fetch/WebSocket (Node 22+). No npm install,
# no throwaway scripts.
#
#   ./bin/cdp.sh smoke [url]     # version + open a page + print its title
#   ./bin/cdp.sh goto <url>      # navigate and wait for the load event
#   ./bin/cdp.sh title           # print document.title
#   ./bin/cdp.sh eval <expr>     # evaluate a JS expression, print the result
#   ./bin/cdp.sh shot <file.png> # save a screenshot of the page
#   ./bin/cdp.sh targets         # list open tabs (url + title)
#
# Worker selection: $CDP_TARGET (worker name), else the first of
# chromium-debug, chromium-1, chromium-*. Exits non-zero on any failure,
# so it can back automated smoke checks as-is.
#
set -euo pipefail
CMD="${1:-help}"; shift || true

# --- resolve worker name: CDP_TARGET -> chromium-1 -> first chromium-* ---
# (a revived attic/debug worker named chromium-debug is still matched by
# the chromium-* fallback)
NAME="${CDP_TARGET:-}"
if [ -z "$NAME" ]; then
    NAME=$(container ls --format json | python3 -c '
import json, sys
ids = [c.get("configuration", {}).get("id", "") for c in json.load(sys.stdin)]
if "chromium-1" in ids:
    print("chromium-1")
else:
    workers = [i for i in ids if i.startswith("chromium-")]
    print(workers[0] if workers else "")')
fi
if [ -z "$NAME" ]; then
    echo "error: no chromium-* worker running (start one: ./bin/dev.sh or ./bin/prod.sh)" >&2
    exit 1
fi

# --- resolve worker IP ---
if ! IP=$(container inspect "$NAME" 2>/dev/null | python3 -c 'import json, sys
d = json.load(sys.stdin); d = d[0] if isinstance(d, list) else d
print(d["status"]["networks"][0]["ipv4Address"].split("/")[0])' 2>/dev/null) || [ -z "$IP" ]; then
    echo "error: worker \"${NAME}\" not found or not running (check: container ls)" >&2
    exit 1
fi

# --- CDP proper: Node built-in fetch + WebSocket (zero dependencies) ---
# The embedded JS must not contain single quotes (it is single-quoted here).
# shellcheck disable=SC2016  # ${...} below are JS template literals, not shell
NAME="$NAME" exec node --input-type=module -e '
const [ip, cmd, ...args] = process.argv.slice(1);
const base = `http://${ip}:9222`;
const j = async (p, o) => (await fetch(base + p, o)).json();

const usage = "usage: cdp.sh smoke [url] | goto URL | title | eval EXPR | shot FILE.png | targets";
if (cmd === "help" || cmd === "--help" || cmd === "-h") { console.log(usage); process.exit(0); }

try {
  if (cmd === "targets") {           // HTTP only, no WebSocket needed
    for (const t of await j("/json/list"))
      if (t.type === "page") console.log(`${t.url}\t${t.title}`);
    process.exit(0);
  }

  // Ensure a page target exists: reuse the first open tab, create one only if
  // none exists. (PUT /json/new ignores its url= parameter on current
  // Chromium — measured — but plain tab creation still works.)
  const page = (await j("/json/list")).find(t => t.type === "page")
            ?? await j("/json/new", { method: "PUT" });

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, ng) => {
    ws.onopen = ok;
    ws.onerror = () => ng(new Error(`cannot connect to ${page.webSocketDebuggerUrl}`));
  });
  // Watchdog: a wedged connection must not hang the CLI forever. unref-ed so
  // it never delays a normal exit.
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
  const goto = async (url) => {       // wait for the load event, not a fixed sleep
    await call("Page.enable");
    const loaded = once("Page.loadEventFired", 15000);
    const nav = await call("Page.navigate", { url });
    // Chromium "successfully" loads an error page on DNS/connect failures;
    // the navigate response carries the real outcome in errorText.
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
    // Default to a live, constantly-changing page: a static page like
    // example.com cannot show that real content is actually being fetched.
    const url = args[0] ?? "https://www.yahoo.co.jp/";
    try {
      await goto(url);
    } catch (e) {
      // A freshly booted worker VM may drop the first request while its
      // network settles (net::ERR_NETWORK_CHANGED). Retry once, visibly.
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
' -- "$IP" "$CMD" "$@"
