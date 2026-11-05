#!/usr/bin/env node
// pin-chromium.mjs —— docker/Dockerfile の CHROMIUM_VERSION と APT_SNAPSHOT を選ぶ。
//
// image は apt の package を全部、APT_SNAPSHOT の時点の snapshot.debian.org から入れ、
// chromium・chromium-common・chromium-sandbox は、ちょうど CHROMIUM_VERSION の版を入れる。
// このスクリプトは 2 つの値を一緒に選ぶ:
//
//   1. 版: base image の codename の最新の chromium（bookworm なら `~deb12u…`）、
//      またはコマンドラインで渡された版
//   2. 時点: image を建てる全部の arch の索引にその版が載っている、
//      いちばん早い debian-security の取り込み。
//      ただし、base image 自身の snapshot の時点（FROM の tag の日付）より前ではないもの
//
// 時点の探索は、3 つの package の両方の arch での first_seen のうち、いちばん遅いものから始める。
// first_seen は .deb が pool に入った時刻で、索引に載った時刻ではない
// （chromium-l10n 156.0.8078.73 が pool に入ったのは 2026-10-29 の 13:12 だが、
// 18:00 の amd64 の索引はまだ .47 を載せていた）。
// だから候補ごとに、Packages の索引そのものに照らす。
//
// 使い方:
//   node bin/pin-chromium.mjs                  # いまの固定と、変えるならどうなるかを出す
//   node bin/pin-chromium.mjs --write          # 最新の版を docker/Dockerfile に書く
//   node bin/pin-chromium.mjs --write <ver>    # 渡した Debian の版を書く
//
// Node 22 以上（fetch）と、PATH の上の `xz` が要る: snapshot は Packages.xz しか配らない。
// docs: configuration/chromium-version。
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SNAPSHOT = "https://snapshot.debian.org";
/** image を建てる arch: Apple Container では arm64、CI では amd64。 */
export const ARCHES = ["amd64", "arm64"];
/** Dockerfile が CHROMIUM_VERSION の版で入れる package。 */
export const PACKAGES = ["chromium", "chromium-common", "chromium-sandbox"];
/** codename ごとの、Debian の stable の更新の接尾辞。例: 156.0.8078.73-1~deb12u1。 */
export const SUFFIX = { bookworm: "~deb12u", trixie: "~deb13u" };
/** 最初の候補の後に試す、debian-security の取り込みの数。 */
const MAX_IMPORTS = 24;

/** Dockerfile のテキストから、base image と固定した 2 つの値を読む。 */
export function readPin(text) {
  const from = /^FROM debian:([a-z]+)-(\d{8})-slim@sha256:[0-9a-f]{64} AS base$/m.exec(text);
  const version = /^ARG CHROMIUM_VERSION=(\S+)$/m.exec(text);
  const snapshot = /^ARG APT_SNAPSHOT=(\S+)$/m.exec(text);
  if (from === null || version === null || snapshot === null) {
    throw new Error(
      "docker/Dockerfile: expected `FROM debian:<codename>-<YYYYMMDD>-slim@sha256:… AS base`, " +
        "`ARG CHROMIUM_VERSION=…` and `ARG APT_SNAPSHOT=…`",
    );
  }
  return {
    codename: from[1],
    // tag の日付は、base image を作った snapshot の時点（debuerreotype）。
    baseSnapshot: `${from[2]}T000000Z`,
    version: version[1],
    snapshot: snapshot[1],
  };
}

/** 2 つの ARG の行を置き換えた Dockerfile のテキストを返す。 */
export function writePin(text, { version, snapshot }) {
  // 文字列ではなく関数で置き換える: 置換の文字列の中の `$` はパターンになる。
  return text
    .replace(/^ARG CHROMIUM_VERSION=\S+$/m, () => `ARG CHROMIUM_VERSION=${version}`)
    .replace(/^ARG APT_SNAPSHOT=\S+$/m, () => `ARG APT_SNAPSHOT=${snapshot}`);
}

/** Debian の版の上流の部分: 156.0.8078.73-1~deb12u1 → 156.0.8078.73。 */
export const upstreamOf = (debianVersion) => debianVersion.split("-")[0];

/** snapshot.debian.org は版を新しい順に並べるので、接尾辞を持つ最初の版を取る。 */
export const newestFor = (versions, suffix) => versions.find((v) => v.includes(suffix));

/** snapshot の時点のうち、いちばん遅いもの（YYYYMMDDTHHMMSSZ は文字列のまま比べられる）。 */
export const latest = (times) => [...times].sort().at(-1);

/** Packages の索引のテキストから作る、package の名前 → 版の集合。 */
export function versionsIn(packagesText, names) {
  const wanted = new Set(names);
  const found = new Map();
  for (const stanza of packagesText.split(/\n\n+/)) {
    const name = /^Package: (\S+)$/m.exec(stanza)?.[1];
    const version = /^Version: (\S+)$/m.exec(stanza)?.[1];
    if (name === undefined || version === undefined || !wanted.has(name)) continue;
    if (!found.has(name)) found.set(name, new Set());
    found.get(name).add(version);
  }
  return found;
}

const getJson = async (path) => {
  const res = await fetch(`${SNAPSHOT}${path}`, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${SNAPSHOT}${path} → ${res.status}`);
  return res.json();
};

/** package と arch を通して、debian-security での first_seen がいちばん遅いもの。 */
async function firstSeen(version) {
  const v = encodeURIComponent(version);
  const times = [];
  for (const name of PACKAGES) {
    const { result, fileinfo } = await getJson(`/mr/package/chromium/${v}/binfiles/${name}/${v}?fileinfo=1`);
    for (const arch of ARCHES) {
      const file = result.find((r) => r.architecture === arch);
      if (file === undefined) throw new Error(`${name} ${version} has no ${arch} build`);
      const seen = (fileinfo[file.hash] ?? [])
        .filter((f) => f.archive_name === "debian-security")
        .map((f) => f.first_seen)
        .sort();
      if (seen.length === 0) throw new Error(`${name} ${version} (${arch}) never reached debian-security`);
      times.push(seen[0]);
    }
  }
  return latest(times);
}

/** `time` の debian-security の索引が、全部の package と arch で `version` を載せているか。 */
async function indexLists(time, codename, version) {
  for (const arch of ARCHES) {
    const url = `${SNAPSHOT}/archive/debian-security/${time}/dists/${codename}-security/main/binary-${arch}/Packages.xz`;
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    const xz = spawnSync("xz", ["-dc"], {
      input: Buffer.from(await res.arrayBuffer()),
      maxBuffer: 512 * 1024 * 1024,
    });
    if (xz.error !== undefined) throw new Error(`xz is needed to read Packages.xz (${xz.error.message})`);
    if (xz.status !== 0) throw new Error(`xz -dc failed: ${xz.stderr.toString()}`);
    const listed = versionsIn(xz.stdout.toString("utf8"), PACKAGES);
    if (!PACKAGES.every((name) => listed.get(name)?.has(version))) return false;
  }
  return true;
}

/** `start` 以降で、索引に `version` が載っている、いちばん早い debian-security の取り込み。 */
async function chooseSnapshot(codename, start, version) {
  const imports = (await getJson(`/mr/timestamp/?archive=debian-security&after=${start}`)).result["debian-security"] ?? [];
  // snapshot に `start` を問うと、その時刻以前の最新の取り込みが返る。
  const candidates = [start, ...imports.filter((t) => t > start)].slice(0, MAX_IMPORTS + 1);
  for (const time of candidates) {
    if (await indexLists(time, codename, version)) return time;
  }
  throw new Error(
    `no debian-security import from ${start} on lists ${version} for ${ARCHES.join(" and ")} ` +
      `(tried ${String(candidates.length)}); the build may still be missing for one architecture`,
  );
}

async function main(argv) {
  const write = argv.includes("--write");
  const unknown = argv.filter((a) => a.startsWith("-") && a !== "--write");
  if (unknown.length > 0) throw new Error(`unknown option: ${unknown.join(" ")} (usage: node bin/pin-chromium.mjs [--write] [<version>])`);
  const wanted = argv.find((a) => !a.startsWith("-"));

  const dockerfile = resolve(dirname(fileURLToPath(import.meta.url)), "../docker/Dockerfile");
  const text = readFileSync(dockerfile, "utf8");
  const pin = readPin(text);
  const suffix = SUFFIX[pin.codename];
  if (suffix === undefined) throw new Error(`no version suffix known for ${pin.codename}; add it to SUFFIX`);

  let version = wanted;
  if (version === undefined) {
    const { result } = await getJson("/mr/package/chromium/");
    version = newestFor(result.map((r) => r.version), suffix);
    if (version === undefined) throw new Error(`no chromium version ends in ${suffix}…`);
  }
  if (!version.includes(suffix)) throw new Error(`${version} is not a ${pin.codename} version (${suffix}…)`);

  const start = latest([pin.baseSnapshot, await firstSeen(version)]);
  const snapshot = await chooseSnapshot(pin.codename, start, version);

  const rows = [
    ["", "now", "chosen"],
    ["CHROMIUM_VERSION", pin.version, version],
    ["APT_SNAPSHOT", pin.snapshot, snapshot],
    ["base snapshot", pin.baseSnapshot, pin.baseSnapshot],
  ];
  const width = Math.max(...rows.map((r) => r[1].length));
  for (const [name, now, chosen] of rows) console.log(`${name.padEnd(16)}  ${now.padEnd(width)}  ${chosen}`);

  const changed = version !== pin.version || snapshot !== pin.snapshot;
  if (!changed) {
    console.log("\ndocker/Dockerfile already has this pin.");
  } else if (write) {
    writeFileSync(dockerfile, writePin(text, { version, snapshot }));
    console.log(`\nWrote docker/Dockerfile. The image will report Chrome/${upstreamOf(version)}.`);
  } else {
    console.log("\nRun with --write to update docker/Dockerfile.");
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`pin-chromium: ${error.message}`);
    process.exit(1);
  });
}
