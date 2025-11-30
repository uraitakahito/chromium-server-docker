## Setup

**Detailed environment setup instructions are described at the beginning of the `Dockerfile`.**

## Chromium Auto-Start

When the container starts, Chromium automatically launches and is viewable via noVNC.

- **noVNC URL:** http://localhost:6080
- **Remote Debugging Port:** 9222 (forwarded from 9223)

### Process Management

Chromium and socat are managed by supervisord. To check status:

```bash
supervisorctl -c /etc/supervisor/conf.d/app.conf status
```

To restart Chromium:

```bash
supervisorctl -c /etc/supervisor/conf.d/app.conf restart chromium
```

### Logs

- Chromium: `/tmp/chromium-stdout.log`, `/tmp/chromium-stderr.log`
- Socat: `/tmp/socat-stdout.log`, `/tmp/socat-stderr.log`
- Supervisord: `/tmp/supervisord.log`
