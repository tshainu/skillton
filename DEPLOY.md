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
- `WEBSITE_URL=https://skillton.69-169-97-195.sslip.io`
- `PORT=8888`
- everything else copied as-is from the sandbox `.env`.

## HTTPS (nginx + Let's Encrypt)

**Live URL: https://skillton.69-169-97-195.sslip.io**

The box has no domain, and no public CA will issue a certificate for a bare IP.
`sslip.io` resolves any `<label>.69-169-97-195.sslip.io` name straight back to
69.169.97.195, so it gives a real DNS hostname — with the IP still visible in it
— that Let's Encrypt will happily certify. No domain purchase, no browser
warnings.

This matters beyond tidiness: browsers only expose `getUserMedia` on a secure
origin, so **the AI interview room cannot work over plain HTTP**. Always send
candidates the `https://` link.

### What is installed
- nginx 1.18 was already on the box serving three PHP apps; these configs were
  added alongside them. No existing vhost was modified.
- `certbot` + `python3-certbot-nginx` (apt).
- One certificate, `--cert-name skillton`, covering nine hostnames.
  Renewal is handled by the `certbot.timer` systemd unit; `certbot renew
  --dry-run` passes. `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh`
  reloads nginx after each renewal.

### Files (versioned in `ops/nginx/`, deployed to the box)
| Repo copy | On the VPS |
| --- | --- |
| `ops/nginx/websocket-map.conf` | `/etc/nginx/conf.d/websocket-map.conf` |
| `ops/nginx/tls.conf` | `/etc/nginx/snippets/tls.conf` |
| `ops/nginx/proxy.conf` | `/etc/nginx/snippets/proxy.conf` |
| `ops/nginx/00-acme.conf` | `/etc/nginx/sites-available/00-acme.conf` |
| `ops/nginx/skillton-https.conf` | `/etc/nginx/sites-available/skillton-https.conf` |
| `ops/nginx/https-gateway.conf` | `/etc/nginx/sites-available/https-gateway.conf` |

The last three are symlinked into `sites-enabled/`.

### Hostname map
Every app on the box got an HTTPS front door. Their original plain-HTTP ports
still work exactly as before — these were added, nothing was taken away.

| HTTPS | Upstream | App |
| --- | --- | --- |
| `skillton.69-169-97-195.sslip.io` | 127.0.0.1:8888 | Skillton |
| `webapp.69-169-97-195.sslip.io` | 127.0.0.1:2026 | pm2 `web-app` |
| `atompos.69-169-97-195.sslip.io` | 127.0.0.1:3031 | pm2 `atom_pos` |
| `leadz.69-169-97-195.sslip.io` | 127.0.0.1:3041 | pm2 `leadz` |
| `idine.69-169-97-195.sslip.io` | 127.0.0.1:6062 | pm2 `idine` |
| `idinelite.69-169-97-195.sslip.io` | 127.0.0.1:6061 | pm2 `idine_lite` |
| `pixal.69-169-97-195.sslip.io` | 127.0.0.1:8050 | nginx + php-fpm |
| `trackup.69-169-97-195.sslip.io` | 127.0.0.1:8080 | nginx + php-fpm |
| `venuepro.69-169-97-195.sslip.io` | 127.0.0.1:8082 | nginx + php-fpm |

`https://69.169.97.195` (bare IP, or any unmatched hostname) hits the
`default_server` block and is served with a self-signed cert from
`/etc/nginx/ssl/` — it works, but every browser will warn. It proxies to
Skillton. Use the sslip.io hostname for anything a candidate sees.

Port 80 redirects everything to HTTPS and serves ACME challenges from
`/var/www/letsencrypt`.

### Port 8888 is closed to the outside
The template's `src/__server.ts` calls `Bun.serve` with no bind address, so the
app always listens on `0.0.0.0`. Rather than edit a `__`-prefixed template file,
an iptables rule drops external traffic to 8888 while leaving loopback open for
nginx:

```
iptables -A INPUT -p tcp --dport 8888 ! -i lo -j DROP
```

Applied at boot by `skillton-firewall.service` →
`/usr/local/sbin/skillton-firewall.sh`. To reopen the port temporarily:
`iptables -D INPUT -p tcp --dport 8888 ! -i lo -j DROP`.

`ufw` is still inactive — deliberately. Enabling it on this box would have to
allow every one of the other apps' ports, and getting that wrong locks out SSH.

### Renew / re-issue by hand
```
certbot renew                      # normally unnecessary, the timer does it
certbot certificates               # what is installed and when it expires
nginx -t && systemctl reload nginx
```

### Verified
- All nine hostnames return 200/302 with `ssl_verify_result=0` (trusted chain).
- `http://` → 301 to `https://`.
- Sign-in + authed RPC over HTTPS return 200 with a working session cookie.
- Headless Chrome on the live URL: `isSecureContext=true` and
  `getUserMedia({audio,video})` returns both tracks — the interview room can
  finally use camera and mic on this host.
- The eight pre-existing HTTP ports still respond as they did before.
