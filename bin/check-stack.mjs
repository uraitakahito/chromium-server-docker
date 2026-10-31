// check-stack.mjs — does the development stack (docker-compose.yml) answer?
//
// Three layers, in order:
//   1. the ports published on the host's loopback: Prometheus, Grafana, CDP
//   2. every Prometheus scrape target is `up` (the DNS names inside the stack resolve)
//   3. inside the chromium container, process-exporter counts exactly one parent chromium
//
// Node 22+ built-ins only (fetch, child_process). `--wait` retries for up to 120 s,
// which bin/stack.sh up uses because container-compose returns before anything answers
// and the <service>.chromium-server names can take about a minute to resolve after start.
import { execFileSync } from "node:child_process";

const WAIT = process.argv.includes("--wait");
const ATTEMPTS = WAIT ? 120 : 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROMETHEUS = "http://127.0.0.1:9090";
const GRAFANA = "http://127.0.0.1:3000";
const CDP = "http://127.0.0.1:9222";
const CHROMIUM = "chromium.chromium-server";
const JOBS = ["chromium-node", "chromium-process", "chromium-cdp", "prometheus"];

const get = async (url, timeoutMs = 3000) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res;
};

/** One pass. Returns the list of problems (empty = healthy) and the table rows. */
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

  // Layer 2: scrape targets. Only meaningful when Prometheus answers.
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
        } else {
          rows.push(["✓", `target ${job}`, target.scrapeUrl]);
        }
      }
    } catch (error) {
      problems.push(`could not list Prometheus targets (${String(error.message).split("\n")[0]})`);
    }
    // The chromium-cdp target being `up` only says blackbox answered Prometheus.
    // Whether CDP itself answered is the probe's result.
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

  // Layer 3: inside the chromium container. The exporter ports are not published,
  // so ask the container itself (needs the `container` CLI).
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
