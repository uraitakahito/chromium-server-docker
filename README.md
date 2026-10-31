# Chromium Server Docker

A container environment for running Chromium with Chrome DevTools Protocol (CDP)
support. The image is meant to be driven externally over CDP — for example by
[BrowserHive](https://github.com/uraitakahito/browserhive).

The single multi-stage [`docker/Dockerfile`](docker/Dockerfile) provides a
headless `production` target, run under
[Apple Container](https://github.com/apple/container) on macOS 26+.
Being a standard OCI image, it also builds and runs on any Docker-compatible
runtime (CI uses Docker).

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

## Dependency updates

Dependabot (`.github/dependabot.yml`) opens **one pull request per group, once a
month**: the docs-site npm dependencies, the Docker base image, and the GitHub
Actions. Security updates for docs-site are grouped into one more pull request
and arrive whenever an alert appears. At most four Dependabot pull requests are
open at any time.

- **Merge when CI is green.** A docs-site PR builds the docs; a Docker PR builds
  the image and checks CDP and the bundled exporters.
- **Do not push commits onto a Dependabot PR.** Dependabot stops rebasing a PR
  someone else has pushed to.
- **After fixing a lockfile by hand** (for example `npm audit fix`), close the
  Dependabot PRs it made obsolete in the same sitting. Dependabot does not close
  security-update PRs whose alert was resolved another way.

## Related Projects

- [BrowserHive](https://github.com/uraitakahito/browserhive) — a scalable web
  page capture server that uses this project as its browser backend (worker pool
  over CDP, screenshot / HTML / WACZ output).
