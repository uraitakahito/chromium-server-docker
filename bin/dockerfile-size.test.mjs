// node --test 'bin/*.test.mjs' —— docker/Dockerfile の大きさの見張り。
//
// Apple Container の `container build` は Dockerfile を gRPC のヘッダで builder へ送り、
// ヘッダが 16 KiB に当たると "Stream unexpectedly closed" で落ちる（apple/container#735）。
// 送る前に base64 と HPACK の Huffman を通すので、上限は生のバイト数では決まらない。
// container 1.6.1 での実測の境目は、ふつうのコメントなら約 15,000 バイト（2026-11-06）。
// CI の Docker にこの上限は無く、超えても緑のままなので、ここで止める。
// #735 が直ったら、この試験は消す。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** 実測の境目より手前に置く。ヘッダには tag や build の引数も載るので、余裕を持たせる。 */
const MAX_BYTES = 14_500;

test("docker/Dockerfile は Apple Container が builder へ送れる大きさに収まっている", () => {
  const { byteLength } = readFileSync(new URL("../docker/Dockerfile", import.meta.url));
  assert.ok(
    byteLength <= MAX_BYTES,
    `docker/Dockerfile が ${String(byteLength)} バイトで、上限の ${String(MAX_BYTES)} を超えている。` +
      "長い説明を docs へ移す（apple/container#735）。",
  );
});
