# Chromium Server Docker

A container environment for running Chromium with Chrome DevTools Protocol (CDP)
support. The image is meant to be driven externally over CDP — for example by
[BrowserHive](https://github.com/uraitakahito/browserhive).

The single multi-stage [`docker/Dockerfile`](docker/Dockerfile) provides a
headless `production` target and a headful `debug` target (VNC/noVNC), run
under [Apple Container](https://github.com/apple/container) on macOS 26+.
Being standard OCI images, they also build and run on any Docker-compatible
runtime (CI uses Docker).

> **attic/** — retired-but-preserved code lives under [`attic/`](attic/).
> Notably the former containerized development image is mothballed at
> [`attic/development/`](attic/development/) with a revival checklist;
> development now happens on the host over CDP (see the docs site).

## Documentation

Full documentation (build, run, Chromium flags, CDP, and internals) lives on the
docs site:

- **English** — <https://uraitakahito.github.io/chromium-server-docker/>
- **日本語** — <https://uraitakahito.github.io/chromium-server-docker/ja/>

The site is built from [`docs-site/`](docs-site/) (Astro + Starlight) and
published to GitHub Pages on every push to `main`.

To edit or preview the docs locally:

```sh
npm --prefix docs-site ci
npm --prefix docs-site run dev
```

## Related Projects

- [BrowserHive](https://github.com/uraitakahito/browserhive) — a scalable web
  page capture server that uses this project as its browser backend (worker pool
  over CDP, screenshot / HTML / WACZ output).
