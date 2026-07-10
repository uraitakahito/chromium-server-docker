# Chromium Server Docker

A Docker environment for running Chromium with Chrome DevTools Protocol (CDP)
support. The image is meant to be driven externally over CDP — for example by
[BrowserHive](https://github.com/uraitakahito/browserhive).

## Documentation

Full documentation (build, run, Chromium flags, CDP, and internals) lives on the
docs site:

- **English** — <https://uraitakahito.github.io/chromium-server-docker/>
- **日本語** — <https://uraitakahito.github.io/chromium-server-docker/ja/>

The site is built from [`docs-site/`](docs-site/) (Astro + Starlight) and
published to GitHub Pages on every push to `develop`.

To edit or preview the docs locally:

```sh
npm --prefix docs-site ci
npm --prefix docs-site run dev
```

## Related Projects

- [BrowserHive](https://github.com/uraitakahito/browserhive) — a scalable web
  page capture server that uses this project as its browser backend (worker pool
  over CDP, screenshot / HTML / WACZ output).
