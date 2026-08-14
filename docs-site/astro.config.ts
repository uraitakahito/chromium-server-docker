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
      // i18n: English = root locale (no prefix) / Japanese = ja (/ja/ prefix).
      // English files stay untouched; Japanese lives under docs/ja/. Untranslated
      // pages fall back to English automatically.
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        ja: { label: "日本語", lang: "ja" },
      },
      // Every entry carries a `ja` translation. Starlight localises pages but
      // not navigation, so without these the Japanese docs are translated
      // pages hanging off an English index.
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
              // The protocol's own name — not a phrase to translate.
              label: "Chrome DevTools Protocol",
              translations: { ja: "Chrome DevTools Protocol" },
              slug: "configuration/cdp",
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
