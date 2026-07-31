import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

const BASE = "/chromium-server-docker";

// The site is served under /chromium-server-docker/ on GitHub Pages.
// Starlight's own navigation is base-aware, but root-absolute links written in
// the MD/MDX body — e.g. [CDP](/configuration/cdp/) — are passed through
// untouched. This rehype pass rewrites those:
//   - prefix the base path so they don't 404, and
//   - for pages under docs/ja/, also inject the /ja locale so an in-site link
//     stays in Japanese instead of jumping to the English page.
// Assets (an href whose last segment has an extension) are base-prefixed only.
// Same approach as datapackage's rehypeBaseLinks.
function rehypeRebaseLinks() {
  return function (tree: any, file: any): void {
    const path: string = file?.path ?? file?.history?.[0] ?? "";
    const inJa = /[\\/]docs[\\/]ja[\\/]/.test(path);
    const walk = (node: any): void => {
      const href = node?.properties?.href;
      if (
        node.tagName === "a" &&
        typeof href === "string" &&
        href.startsWith("/") &&
        !href.startsWith("//") &&
        !href.startsWith(BASE + "/") &&
        href !== BASE
      ) {
        const lastSeg = href.split(/[?#]/)[0].split("/").pop() ?? "";
        const isAsset = lastSeg.includes(".");
        const locale =
          inJa && !isAsset && !href.startsWith("/ja/") && href !== "/ja" ? "/ja" : "";
        node.properties.href = BASE + locale + href;
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
  };
}

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
  markdown: { rehypePlugins: [rehypeRebaseLinks] },
});
