# Skillton — deployment

## GitHub
- Repo: https://github.com/tshainu/skillton (branch `main`)
- `.env` is git-ignored and is **not** in the repo. It lives only on the server.

## VPS
- Host: `69.169.97.195` (root)
- App dir: `/var/www/skillton`
- Live URL: http://69.169.97.195:8888
- Process manager: pm2, app name **`skillton`** (pm2 config: `skillton.config.cjs`)
  - Do not use `ecosystem.config.cjs` on this box — its app name `web-app` is already
    taken by another project running on port 2026.
- Logs: `/var/log/skillton-out.log`, `/var/log/skillton-err.log`
- Auto-start on reboot: `pm2 save` + `pm2 startup` (systemd) already configured.

### Redeploy after pushing new code

```bash
ssh root@69.169.97.195
cd /var/www/skillton
git pull
bun install
bun run build:web          # vite build only; `bun run build` also runs tsc and is slower
pm2 restart skillton --update-env
pm2 save
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8888/
```

### Server .env differences vs the sandbox
- `WEBSITE_URL=http://69.169.97.195:8888`
- `PORT=8888`
- everything else copied as-is from the sandbox `.env`.

### Notes
- `ufw` is inactive on the box, so 8888 is reachable directly; no nginx vhost needed.
- Auth cookies work over plain HTTP on this host (verified sign-in + RPC calls).
- Serving over HTTP means browsers still allow camera/mic on `localhost` only —
  for the AI interview room on a public host, a domain + HTTPS is required.
  Right now the interview room will be blocked from using camera/mic at
  http://69.169.97.195:8888. Point a domain at the box and terminate TLS with
  nginx/Caddy before running live interviews from this URL.
