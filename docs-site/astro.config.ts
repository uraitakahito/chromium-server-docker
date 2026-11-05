import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { satteri } from "@astrojs/markdown-satteri";
import hastRebaseLinks from "./src/plugins/hast-rebase-links";

const BASE = "/chromium-server-docker";

// https://astro.build/config
export default defineConfig({
  site: "https://uraitakahito.github.io",
  base: BASE,
  integrations: [
    starlight({
      title: "chromium-server-docker",
      // i18n: 英語は root locale(接頭辞なし)、日本語は ja(接頭辞 /ja/)。
      // 英語のファイルはそのままで、日本語は docs/ja/ の下に置く。
      // 訳していないページは、自動で英語にフォールバックする。
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        ja: { label: "日本語", lang: "ja" },
      },
      // どの項目にも `ja` の訳を付ける。
      // Starlight はページを多言語にするが、ナビゲーションはしないので、
      // これが無いと、日本語の docs は、英語の目次の下に訳のページがぶら下がる形になる。
      sidebar: [
        {
          label: "Getting started",
          translations: { ja: "はじめに" },
          items: [
            {
              label: "Production (headless)",
              translations: { ja: "本番（headless）" },
              slug: "getting-started/production",
            },
            {
              label: "Verifying workers",
              translations: { ja: "worker の動作確認" },
              slug: "getting-started/verify",
            },
            {
              label: "Monitoring stack",
              translations: { ja: "監視スタック" },
              slug: "getting-started/monitoring",
            },
          ],
        },
        {
          label: "Configuration",
          translations: { ja: "設定" },
          items: [
            {
              label: "Chromium flags",
              translations: { ja: "Chromium フラグ" },
              slug: "configuration/chromium-flags",
            },
            {
              // プロトコルそのものの名前で、訳す語句ではない。
              label: "Chrome DevTools Protocol",
              translations: { ja: "Chrome DevTools Protocol" },
              slug: "configuration/cdp",
            },
            {
              label: "Metrics",
              translations: { ja: "メトリクス" },
              slug: "configuration/metrics",
            },
            {
              label: "Chromium version",
              translations: { ja: "Chromium の版" },
              slug: "configuration/chromium-version",
            },
          ],
        },
        {
          label: "Internals",
          translations: { ja: "内部構造" },
          items: [
            {
              label: "Driving model & dbus",
              translations: { ja: "駆動モデルと dbus" },
              slug: "internals/driving-model",
            },
          ],
        },
      ],
    }),
  ],
  markdown: {
    // Astro 7.2 の既定プロセッサ。legacy の rehypePlugins は
    // @astrojs/markdown-remark(unified) を要求するので、そちらは使わない。
    // この repo は file="…#region" を使っていないので mdastPlugins は無い。
    processor: satteri({ hastPlugins: [hastRebaseLinks] }),
  },
});
