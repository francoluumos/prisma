# Seed the Prisma catalog into Odoo — run via `odoo shell`.
#
#   docker compose run --rm --no-deps -T odoo odoo shell \
#     -c /etc/odoo/odoo.conf -d prisma --no-http < seed_products.py
#
# Deliberately mirrors supabase/migrations/20260730120100_commerce_seed.sql:
# same default_code SKUs, same list prices, and the SAME ir.model.data external
# IDs (module "prisma"). That is principle 2 of docs/commerce-backend.md — the
# later Supabase->Odoo sync becomes a field map, and re-running either side
# updates rather than duplicates.
#
# Idempotent: keyed on default_code, safe to re-run.
#
# NO TAXES are set on these products. Prisma Cycling is not VAT-registered, and
# in Switzerland an unregistered business must not charge MWST. Odoo would
# otherwise attach the company default (8.1%) to every new product. When
# registration happens (mandatory above CHF 100k turnover), set the company
# default tax and add taxes_id here — do not leave it to chance.

CATEGORIES = ["Aero road bike — racing", "All-road gravel bike", "Delivery"]

# (default_code, name, category, type, storable, list_price)
PRODUCTS = [
    ("PRISMA-ONE",   "Prisma One",                "Aero road bike — racing", "consu",   True,  1414.0),
    ("PRISMA-TERRA", "Prisma Terra",              "All-road gravel bike",    "consu",   True,  1240.0),
    ("DELIV-HOME",   "Home delivery",             "Delivery",                "service", False,   59.0),
    ("DELIV-PICKUP", "Pickup at a local partner", "Delivery",                "service", False,  149.0),
]

Category = env["product.category"]
Product = env["product.product"]
IMD = env["ir.model.data"]

cats = {}
for label in CATEGORIES:
    cat = Category.search([("name", "=", label)], limit=1)
    if not cat:
        cat = Category.create({"name": label})
    cats[label] = cat

# Odoo 18+ split "stockable" out of `type` into the is_storable boolean; older
# versions used type="product". Support whichever this build exposes.
has_is_storable = "is_storable" in Product._fields

for code, name, cat_label, ptype, storable, price in PRODUCTS:
    vals = {
        "name": name,
        "default_code": code,
        "categ_id": cats[cat_label].id,
        "list_price": price,
        "sale_ok": True,
        "purchase_ok": ptype == "consu",
        # Not VAT-registered: no customer or supplier tax, explicitly.
        "taxes_id": [(6, 0, [])],
        "supplier_taxes_id": [(6, 0, [])],
    }
    if has_is_storable:
        vals["type"] = ptype
        vals["is_storable"] = storable
    else:
        vals["type"] = "product" if storable else ptype

    prod = Product.search([("default_code", "=", code)], limit=1)
    if prod:
        prod.write(vals)
        action = "updated"
    else:
        prod = Product.create(vals)
        action = "created"

    # Stable external ID, matching the Supabase seed's naming.
    xmlid = "product_" + code.lower().replace("-", "_")
    existing = IMD.search(
        [("module", "=", "prisma"), ("name", "=", xmlid)], limit=1
    )
    if not existing:
        IMD.create({
            "module": "prisma",
            "name": xmlid,
            "model": "product.product",
            "res_id": prod.id,
            "noupdate": True,
        })

    print(f"PRODUCT {action:8s} {code:14s} {name:26s} CHF {price:8.2f} "
          f"tax={len(prod.taxes_id)}")

env.cr.commit()
print("SEED_DONE", Product.search_count([("default_code", "in", [p[0] for p in PRODUCTS])]))
