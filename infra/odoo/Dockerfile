# Odoo 19 Community plus the OCA modules that supply what Enterprise keeps back.
#
# Community ships the same double-entry engine as Enterprise; what it lacks is
# the reporting and automation layer on top — Balance Sheet, P&L, general
# ledger, bank reconciliation. These OCA packages restore that. What stays
# missing is automated bank feed sync and OCR bill scanning, which are genuinely
# Enterprise-only; CAMT.053 file import covers the bank side for Swiss banks.
FROM odoo:19

USER root

# OCA distributes its addons on PyPI as odoo-addon-<module>. Pinning to the
# 19.0 series keeps `docker compose build` reproducible instead of silently
# tracking whatever landed upstream today.
RUN pip install --no-cache-dir --break-system-packages \
      "odoo-addon-account-financial-report>=19.0dev,<19.1dev" \
      "odoo-addon-mis-builder>=19.0dev,<19.1dev" \
      "odoo-addon-account-reconcile-oca>=19.0dev,<19.1dev" \
      "odoo-addon-account-statement-import-camt>=19.0dev,<19.1dev"

USER odoo
