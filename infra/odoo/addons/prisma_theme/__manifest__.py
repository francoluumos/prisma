{
    "name": "Prisma Theme",
    "summary": "Luumos brand accent for the Odoo backend",
    "description": """
Replaces Odoo's default violet chrome with the Luumos identity: a transparent
navbar over the app canvas with a hairline rule, ink text, and Luumos Blue
(#2563EB) as the single accent on primary buttons, active states and links.

Palette from luumos-agency/DESIGN.md. Kept as a plain CSS asset rather than
SCSS so it layers over Odoo's compiled bundle without needing to match its
internal variable names across upgrades.
""",
    "version": "19.0.1.0.0",
    "category": "Theme",
    "author": "Prisma Cycling",
    "license": "LGPL-3",
    "depends": ["web"],
    "assets": {
        "web.assets_backend": [
            "prisma_theme/static/src/css/theme.css",
        ],
    },
    "installable": True,
    "application": False,
    "auto_install": False,
}
