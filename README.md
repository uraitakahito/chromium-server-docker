# Chromium Server Docker

A container environment for running Chromium with Chrome DevTools Protocol (CDP)
support. The image is meant to be driven externally over CDP — for example by
BrowserHive, a web page capture server.

The single multi-stage [`docker/Dockerfile`](docker/Dockerfile) provides a
headless `production` target, run under
[Apple Container](https://github.com/apple/container) on macOS 26+.
Being a standard OCI image, it also builds and runs on any Docker-compatible
runtime (CI uses Docker).

Chromium is Debian's `chromium`, pinned: `CHROMIUM_VERSION` and `APT_SNAPSHOT`
in `docker/Dockerfile` fix the Chromium version and the snapshot.debian.org time
every apt package comes from. `node bin/pin-chromium.mjs --write` moves both
(see *Chromium version* on the docs site).

> **attic/** — retired-but-preserved code lives under [`attic/`](attic/),
> each unit self-contained with a revival checklist: the former containerized
> development image ([`attic/development/`](attic/development/)) and the
> former headful `debug` target ([`attic/debug/`](attic/debug/)). Visual
> verification now uses the `chrome://inspect` screencast against headless
> workers — see the docs site.

## Documentation

Full documentation (build, run, the monitoring stack, Chromium flags, CDP,
metrics, and internals) lives on the docs site:

- **English** — <https://uraitakahito.github.io/chromium-server-docker/>
- **日本語** — <https://uraitakahito.github.io/chromium-server-docker/ja/>

The site is built from [`docs-site/`](docs-site/) (Astro + Starlight) and
published to GitHub Pages on every release tag (`v*`).

To edit or preview the docs locally:

```sh
npm --prefix docs-site ci
npm --prefix docs-site run dev
```

## Related Projects

- BrowserHive — a web page capture server that uses this project as its browser
  backend (screenshot / HTML / WACZ output over CDP).
