// check-stack.mjs —— 開発スタック（docker-compose.yml）は答えているか。
//
// 3 つの層を順に見る:
//   1. host の loopback に publish した口: Prometheus・Grafana・CDP。
//      さらに、CDP の先の Chromium が docker/Dockerfile の固定した版であること
//   2. Prometheus の scrape の target が全部 `up` であること（スタックの中の DNS 名が引ける）。
//      さらに、chromium-* の job の instance が口を外したコンテナの名前であること
//      （dashboard の $instance の変数と rule の summary がこれに頼る）
//   3. chromium のコンテナの中で、process-exporter が親の chromium をちょうど 1 つ数えること
//
// Node 22 以上の組み込みだけを使う（fetch・child_process・fs）。`--wait` は最大 120 秒やり直す。
// bin/stack.sh up がこれを使うのは、container-compose が何も答えないうちに戻り、
// 起動の後 <service>.chromium-server の名前が引けるまで 1 分ほど掛かることがあるから。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { readPin, upstreamOf } from "./pin-chromium.mjs";

const WAIT = process.argv.includes("--wait");
const ATTEMPTS = WAIT ? 120 : 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROMETHEUS = "http://127.0.0.1:9090";
const GRAFANA = "http://127.0.0.1:3000";
const CDP = "http://127.0.0.1:9222";
const CHROMIUM = "chromium.chromium-server";
const JOBS = ["chromium-node", "chromium-process", "chromium-cdp", "prometheus"];
/** /json/version が返すべき物: ARG CHROMIUM_VERSION の上流の部分。 */
const PINNED = `Chrome/${upstreamOf(readPin(readFileSync(new URL("../docker/Dockerfile", import.meta.url), "utf8")).version)}`;

const get = async (url, timeoutMs = 3000) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res;
};

/** 1 回分の点検。問題の一覧（空なら正常）と表の行を返す。 */
const inspect = async () => {
  const rows = [];
  const problems = [];
  const port = async (name, url, verify) => {
    try {
      const res = await get(url);
      if (verify) await verify(res);
      rows.push(["✓", name, url]);
    } catch (error) {
      rows.push(["✗", name, url]);
      problems.push(`${name} does not answer at ${url} (${String(error.message).split("\n")[0]})`);
    }
  };
  await port("prometheus", `${PROMETHEUS}/-/ready`);
  await port("grafana", `${GRAFANA}/api/health`, async (res) => {
    const body = await res.json();
    if (body.database !== "ok") throw new Error(`database=${String(body.database)}`);
  });
  await port("chromium (CDP)", `${CDP}/json/version`);
  // いまの固定より前に建てた image のコンテナも同じように答えるので、どの Chromium かを訊く。
  if (!problems.some((p) => p.startsWith("chromium (CDP)"))) {
    try {
      const { Browser } = await (await get(`${CDP}/json/version`)).json();
      if (Browser === PINNED) {
        rows.push(["✓", "chromium version", `${Browser} (pinned in docker/Dockerfile)`]);
      } else {
        rows.push(["✗", "chromium version", String(Browser)]);
        problems.push(`chromium reports ${String(Browser)}, but docker/Dockerfile pins ${PINNED} (an image built before the pin? ./bin/stack.sh up rebuilds it)`);
      }
    } catch (error) {
      problems.push(`could not read the Chromium version (${String(error.message).split("\n")[0]})`);
    }
  }

  // 層 2: scrape の target。Prometheus が答えるときだけ意味がある。
  if (!problems.some((p) => p.startsWith("prometheus"))) {
    try {
      const { data } = await (await get(`${PROMETHEUS}/api/v1/targets?state=any`)).json();
      const byJob = new Map(data.activeTargets.map((t) => [t.labels.job, t]));
      for (const job of JOBS) {
        const target = byJob.get(job);
        if (target === undefined) {
          rows.push(["✗", `target ${job}`, "(not in prometheus.yml?)"]);
          problems.push(`scrape job ${job} is missing from Prometheus`);
        } else if (target.health !== "up") {
          rows.push(["✗", `target ${job}`, target.scrapeUrl]);
          problems.push(`scrape job ${job} is ${target.health}: ${target.lastError || "(no error text)"}`);
        } else if (job !== "prometheus" && target.labels.instance !== CHROMIUM) {
          rows.push(["✗", `target ${job}`, `instance = ${target.labels.instance}`]);
          problems.push(`scrape job ${job} has instance ${target.labels.instance}, expected ${CHROMIUM} (the relabel_configs in prometheus.yml; the dashboard's $instance needs the container name without the port)`);
        } else {
          rows.push(["✓", `target ${job}`, target.scrapeUrl]);
        }
      }
    } catch (error) {
      problems.push(`could not list Prometheus targets (${String(error.message).split("\n")[0]})`);
    }
    // chromium-cdp の target が `up` でも、blackbox が Prometheus に答えたとしか言えない。
    // CDP 自身が答えたかは、probe の結果で見る。
    try {
      const url = `${PROMETHEUS}/api/v1/query?query=${encodeURIComponent('probe_success{job="chromium-cdp"}')}`;
      const { data } = await (await get(url)).json();
      const value = data.result[0]?.value[1];
      if (value === "1") {
        rows.push(["✓", "probe chromium-cdp", "probe_success = 1 (CDP /json/version answered blackbox)"]);
      } else {
        rows.push(["✗", "probe chromium-cdp", `probe_success = ${value ?? "(no sample yet)"}`]);
        problems.push(`blackbox cannot reach CDP: probe_success{job="chromium-cdp"} is ${value ?? "absent"} (chromium starting, or the probe's Host header is refused)`);
      }
    } catch (error) {
      problems.push(`could not query probe_success (${String(error.message).split("\n")[0]})`);
    }
  }

  // 層 3: chromium のコンテナの中。exporter の口は publish していないので、
  // コンテナ自身に訊く（`container` の CLI が要る）。
  try {
    const text = execFileSync(
      "container",
      ["exec", CHROMIUM, "curl", "-sf", "-m", "3", "http://localhost:9256/metrics"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    if (/^namedprocess_namegroup_num_procs\{groupname="chromium-browser"\} 1$/m.test(text)) {
      rows.push(["✓", "process-exporter", `${CHROMIUM}:9256 (chromium-browser = 1)`]);
    } else {
      rows.push(["✗", "process-exporter", `${CHROMIUM}:9256`]);
      problems.push(`process-exporter answers but does not count exactly one chromium-browser (chromium still starting, or the image predates v0.7.0?)`);
    }
  } catch {
    rows.push(["✗", "process-exporter", `${CHROMIUM}:9256`]);
    problems.push(`process-exporter inside ${CHROMIUM} does not answer (container missing, or the image predates v0.7.0)`);
  }
  return { rows, problems };
};

let result = await inspect();
for (let attempt = 1; attempt < ATTEMPTS && result.problems.length > 0; attempt++) {
  if (process.stdout.isTTY) process.stdout.write(`\r   waiting (${String(attempt)}/${String(ATTEMPTS)}) — ${result.problems.length} problem(s)      `);
  await sleep(1000);
  result = await inspect();
}
if (WAIT && process.stdout.isTTY) process.stdout.write(`\r${" ".repeat(70)}\r`);

const width = Math.max(...result.rows.map(([, name]) => name.length));
console.log("── stack check (chromium-server)");
for (const [mark, name, where] of result.rows) console.log(`   ${mark} ${name.padEnd(width)}  ${where}`);
if (result.problems.length > 0) {
  console.error("");
  for (const problem of result.problems) console.error(`   ${problem}`);
  console.error(WAIT ? `\nStill failing after ${String(ATTEMPTS)} s. Start with: ./bin/stack.sh up` : "\nJust started? Retry with: ./bin/stack.sh check --wait");
  process.exit(1);
}
console.log("\nGrafana: http://127.0.0.1:3000/d/chromium   Prometheus: http://127.0.0.1:9090/targets");
