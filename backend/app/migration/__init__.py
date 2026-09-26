"""Upgrading existing projects to the foundation schema (foundation spec §11).

Kept free of imports: `app.db.session` imports `app.migration.backup`, and the job modules import
the project registry, so anything imported here would be an import cycle.
"""
