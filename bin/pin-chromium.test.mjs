// node --test 'bin/*.test.mjs' —— pin-chromium.mjs の純粋な部分の試験。
// 通信する部分は、スクリプトそのものを走らせて確かめる（docs: configuration/chromium-version）。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { latest, newestFor, readPin, upstreamOf, versionsIn, writePin } from "./pin-chromium.mjs";

const SAMPLE = `ARG CHROMIUM_VERSION=156.0.8078.47-1~deb12u1
ARG APT_SNAPSHOT=20261023T104441Z

FROM debian:bookworm-20261027-slim@sha256:${"a".repeat(64)} AS base

ARG CHROMIUM_VERSION
ARG APT_SNAPSHOT
`;

test("readPin reads the codename, the base snapshot and both pinned values", () => {
  assert.deepEqual(readPin(SAMPLE), {
    codename: "bookworm",
    baseSnapshot: "20261027T000000Z",
    version: "156.0.8078.47-1~deb12u1",
    snapshot: "20261023T104441Z",
  });
});

test("readPin reads the repository's own Dockerfile", () => {
  const pin = readPin(readFileSync(new URL("../docker/Dockerfile", import.meta.url), "utf8"));
  assert.match(pin.version, /^\d+\.\d+\.\d+\.\d+-\d+~deb\d+u\d+$/);
  assert.match(pin.snapshot, /^\d{8}T\d{6}Z$/);
  assert.ok(pin.snapshot >= pin.baseSnapshot, "APT_SNAPSHOT must not be earlier than the base snapshot");
});

test("readPin refuses a Dockerfile without the pin", () => {
  assert.throws(() => readPin("FROM debian:bookworm-slim AS base\n"), /ARG CHROMIUM_VERSION/);
});

test("writePin replaces only the two ARG lines with defaults", () => {
  const out = writePin(SAMPLE, { version: "156.0.8078.73-1~deb12u1", snapshot: "20261029T185537Z" });
  assert.match(out, /^ARG CHROMIUM_VERSION=156\.0\.8078\.73-1~deb12u1$/m);
  assert.match(out, /^ARG APT_SNAPSHOT=20261029T185537Z$/m);
  // 段の中の宣言し直しは、値を持たないまま。
  assert.match(out, /^ARG CHROMIUM_VERSION$/m);
  assert.match(out, /^ARG APT_SNAPSHOT$/m);
});

test("writePin writes a `$` literally", () => {
  const out = writePin(SAMPLE, { version: "1.0-1$&", snapshot: "20261029T185537Z" });
  assert.match(out, /^ARG CHROMIUM_VERSION=1\.0-1\$&$/m);
});

test("upstreamOf drops the Debian revision", () => {
  assert.equal(upstreamOf("156.0.8078.73-1~deb12u1"), "156.0.8078.73");
});

test("newestFor takes the first version with the codename's suffix", () => {
  const versions = ["156.0.8078.73-1", "156.0.8078.73-1~deb13u1", "156.0.8078.73-1~deb12u1", "156.0.8078.47-1~deb12u1"];
  assert.equal(newestFor(versions, "~deb12u"), "156.0.8078.73-1~deb12u1");
  assert.equal(newestFor(versions, "~deb11u"), undefined);
});

test("latest compares snapshot times as text", () => {
  assert.equal(latest(["20261027T000000Z", "20261029T185537Z", "20261029T173424Z"]), "20261029T185537Z");
});

test("versionsIn collects the versions of the wanted packages only", () => {
  const text = [
    "Package: chromium\nVersion: 156.0.8078.73-1~deb12u1\nArchitecture: amd64",
    "Package: chromium-common\nVersion: 156.0.8078.73-1~deb12u1",
    "Package: chromium-l10n\nVersion: 156.0.8078.73-1~deb12u1",
    "Package: chromium\nVersion: 156.0.8078.47-1~deb12u1",
  ].join("\n\n");
  const found = versionsIn(text, ["chromium", "chromium-common", "chromium-sandbox"]);
  assert.deepEqual([...found.get("chromium")].sort(), ["156.0.8078.47-1~deb12u1", "156.0.8078.73-1~deb12u1"]);
  assert.deepEqual([...found.get("chromium-common")], ["156.0.8078.73-1~deb12u1"]);
  assert.equal(found.has("chromium-sandbox"), false);
  assert.equal(found.has("chromium-l10n"), false);
});
