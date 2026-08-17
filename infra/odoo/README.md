# Prisma ERP — Odoo 19 Community, self-hosted

Docker Compose stack for the Prisma books and back-office: **Odoo 19 Community
+ OCA accounting modules + Postgres 16 + Caddy** for automatic TLS.

**Target: Hostinger VPS `1910052` (`191.215.41.153`) only.** VPS `1806948` — the
Docker/Traefik box — is out of scope and must not be touched.

> Status: greenfield. This does *not* replace the Supabase commerce layer.
> `docs/commerce-backend.md` §9 lists the triggers for moving Prisma's system of
> record to Odoo; until two of them are true, this is the sandbox that gets
> ready in advance.

---

## Why Community needs add-ons for "accounting"

Community ships the **same double-entry engine** as Enterprise. What Enterprise
keeps back is the layer on top:

| Need | Community answer |
|---|---|
| Balance Sheet, P&L, general ledger, trial balance, aged partner | OCA `account_financial_report` |
| Custom financial reports / KPIs | OCA `mis_builder` |
| Bank reconciliation UI | OCA `account_reconcile_oca` |
| Swiss VAT + QR-bill | `l10n_ch`, already in core |
| Bank statement import (CAMT.053) | OCA `account_statement_import_camt` |

Installed from PyPI by the `Dockerfile`, pinned to the 19.0 series.

**Genuinely still missing**, and no add-on fixes it: automated bank *feed* sync
and OCR bill scanning are Enterprise-only. CAMT.053 file import covers the bank
side for Swiss banks — you download the file and import it, rather than it
arriving by itself. **Multi-company consolidation is also Enterprise-only**, so
this instance keeps Prisma's books and Prisma's alone.

---

## What this replaces, and why

The Hostinger "Ubuntu 24.04 with Odoo" template left the box like this, publicly
reachable, ~2.5 h after creation:

```
server_version         19.0-20260817
port 8069         ->   200, plain HTTP, Werkzeug dev server
port 80 / 443     ->   connection timed out          (no TLS at all)
/web/database/manager  200                           (open to the internet)
db.list           ->   ["prisma"]                    (list_db on)
```

Anyone who found the IP could reach the database manager and, with the master
password, drop or download the database. This stack closes each of those:

| Then | Now |
|---|---|
| Odoo on `0.0.0.0:8069` | only Caddy publishes ports; Odoo is compose-internal |
| plain HTTP | Caddy + Let's Encrypt, HSTS |
| database manager open | `list_db = False`, plus Caddy 404s the routes |
| default master password | `ADMIN_PASSWD` from `.env`, never committed |
| Werkzeug dev server | multi-worker Odoo behind a real proxy |
| no firewall | Hostinger firewall, SSH restricted (set up separately) |

---

## First deploy

SSH to the VPS as root.

**1. Remove the template install.** It occupies 8069, 80 and 443, and the new
stack cannot bind while it runs. Check what's there before deleting:

```bash
systemctl list-units --type=service | grep -i odoo
docker ps -a                     # the template may use either
```

Then, for the systemd flavour:

```bash
systemctl stop odoo && systemctl disable odoo
```

Or, if it runs in Docker — note this only touches the template's own project:

```bash
docker compose -f /path/to/template/docker-compose.yml down
```

The template's `prisma` database is a stock empty install with nothing worth
keeping. If you want a safety net anyway, take a Hostinger snapshot first.

**2. Install the stack.**

```bash
mkdir -p /opt/prisma-erp && cd /opt/prisma-erp
# copy this directory here (git clone, scp, rsync — whatever suits)

cp .env.example .env
openssl rand -base64 24   # -> DB_PASSWORD
openssl rand -base64 24   # -> ADMIN_PASSWD
nano .env                 # paste both; check ODOO_HOSTNAME

chmod +x render-config.sh backup.sh
./render-config.sh
docker compose up -d --build
```

**3. Create the database with Swiss localisation.** `list_db = False` disables
the web creation screen by design, so create it from the CLI:

```bash
docker compose exec odoo odoo \
  -c /etc/odoo/odoo.conf \
  -d prisma -i base,l10n_ch,account,account_financial_report,mis_builder \
  --without-demo=all --stop-after-init
docker compose restart odoo
```

`--without-demo=all` matters: demo data in a system that will hold real books is
a mess to unpick later.

**4. Verify** — every line should read as shown:

```bash
curl -sI  https://srv1910052.hstgr.cloud            | head -1   # 200 or 303
curl -sI  http://srv1910052.hstgr.cloud             | head -1   # 308 -> https
curl -so /dev/null -w '%{http_code}\n' \
     https://srv1910052.hstgr.cloud/web/database/manager        # 404
curl -sS -X POST -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","method":"call","params":{"service":"db","method":"list","args":[]}}' \
     https://srv1910052.hstgr.cloud/jsonrpc                     # error, not a list
ss -tlnp | grep -E ':(8069|8072|5432)'                          # no public bind
```

Then log in and **change the admin user's password immediately** — the initial
one is set at database creation and is not the master password.

---

## Day-to-day

```bash
docker compose logs -f odoo          # tail
docker compose restart odoo          # after a config change
./render-config.sh && docker compose restart odoo   # after editing the template
docker compose pull && docker compose up -d --build # update images
```

Install more OCA modules by adding them to the `Dockerfile` and rebuilding —
not by pip-installing into a running container, which is lost on the next
`up`.

## Backups

`backup.sh` dumps **both** the database and the filestore; a dump alone restores
an Odoo with no attachments or invoice PDFs. It verifies the dump reads back and
fails loudly if not.

```bash
( crontab -l 2>/dev/null | grep -v backup.sh || true; \
  echo "15 3 * * * cd /opt/prisma-erp && ./backup.sh >> /var/log/prisma-erp-backup.log 2>&1" ) | crontab -
```

The `|| true` is load-bearing: under `set -e`, `grep` exits 1 on an empty
crontab and aborts the subshell before the `echo`, quietly installing an empty
crontab and no backup job at all.

It writes to the same VPS, which is not a backup strategy on its own — copy them
off-box. Hostinger snapshots are not a substitute: point-in-time, easily
overwritten, and gone with the subscription.

## Moving to erp.prismacycling.ch

`erp.prismacycling.ch` currently resolves to `217.26.48.101`, Hostpoint's
wildcard — not this VPS. Add an A record at Hostpoint pointing it to
`191.215.41.153`, wait for propagation, then set `ODOO_HOSTNAME` in `.env` and
`docker compose up -d caddy`. Caddy issues the new certificate on its own.
