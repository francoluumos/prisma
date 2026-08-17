# Runs the Supabase -> Odoo sync inside the compose network, so it can reach
# odoo:8069 directly and Odoo never needs a published port on the host.
FROM node:22-alpine
WORKDIR /app
COPY sync.mjs .
# No dependencies on purpose — Node 22 has fetch built in, so there is no
# package.json, no lockfile and nothing to audit or keep current.
ENTRYPOINT ["node", "/app/sync.mjs"]
