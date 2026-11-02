#!/usr/bin/env node
// pin-chromium.mjs — choose CHROMIUM_VERSION and APT_SNAPSHOT for docker/Dockerfile.
//
// The image installs every apt package from snapshot.debian.org at APT_SNAPSHOT, and
// chromium / chromium-common / chromium-sandbox at exactly CHROMIUM_VERSION. This
// script picks the two values together:
//
//   1. the version: the newest chromium for the base image's codename
//      (bookworm → `~deb12u…`), or the one given on the command line;
//   2. the time: the earliest debian-security import whose index lists that version
//      for every architecture the image is built for, and which is not earlier than
//      the base image's own snapshot time (the FROM tag's date).
//
// The search for the time starts at the latest first_seen of the three packages on
// both architectures. first_seen is when a .deb reached the pool, not when the index
// listed it (chromium-l10n 156.0.8078.73 reached the pool at 13:12 on 2026-10-29,
// while the amd64 index still listed .47 at 18:00), so each candidate is checked
// against the Packages index itself.
//
// Usage:
//   node bin/pin-chromium.mjs                  # show the pin and what it would become
//   node bin/pin-chromium.mjs --write          # write the newest version into docker/Dockerfile
//   node bin/pin-chromium.mjs --write <ver>    # write the given Debian version
//
// Needs Node 22+ (fetch) and `xz` on PATH: the snapshot serves Packages.xz only.
// Docs: configuration/chromium-version.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SNAPSHOT = "https://snapshot.debian.org";
/** The architectures the image is built for: arm64 under Apple Container, amd64 in CI. */
export const ARCHES = ["amd64", "arm64"];
/** The packages the Dockerfile installs at CHROMIUM_VERSION. */
export const PACKAGES = ["chromium", "chromium-common", "chromium-sandbox"];
/** Debian's stable-update suffix for each codename, e.g. 156.0.8078.73-1~deb12u1. */
export const SUFFIX = { bookworm: "~deb12u", trixie: "~deb13u" };
/** How many debian-security imports to try after the first candidate. */
const MAX_IMPORTS = 24;

/** Reads the base image and the two pinned values from the Dockerfile text. */
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
    // The tag's date is the snapshot time the base image was built from (debuerreotype).
    baseSnapshot: `${from[2]}T000000Z`,
    version: version[1],
    snapshot: snapshot[1],
  };
}

/** Returns the Dockerfile text with both ARG lines replaced. */
export function writePin(text, { version, snapshot }) {
  // Replacement functions, not strings: a `$` in a replacement string is a pattern.
  return text
    .replace(/^ARG CHROMIUM_VERSION=\S+$/m, () => `ARG CHROMIUM_VERSION=${version}`)
    .replace(/^ARG APT_SNAPSHOT=\S+$/m, () => `ARG APT_SNAPSHOT=${snapshot}`);
}

/** The upstream part of a Debian version: 156.0.8078.73-1~deb12u1 → 156.0.8078.73. */
export const upstreamOf = (debianVersion) => debianVersion.split("-")[0];

/** snapshot.debian.org lists versions newest first; the first with the suffix wins. */
export const newestFor = (versions, suffix) => versions.find((v) => v.includes(suffix));

/** The latest of some snapshot times (YYYYMMDDTHHMMSSZ sorts as text). */
export const latest = (times) => [...times].sort().at(-1);

/** Package name → set of versions, from the text of a Packages index. */
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

/** The latest first_seen in debian-security over the packages and architectures. */
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

/** Whether the debian-security index at `time` lists `version` for every package and architecture. */
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

/** The earliest debian-security import, at or after `start`, whose index lists `version`. */
async function chooseSnapshot(codename, start, version) {
  const imports = (await getJson(`/mr/timestamp/?archive=debian-security&after=${start}`)).result["debian-security"] ?? [];
  // Asking the snapshot for `start` yields the latest import at or before it.
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
