# Migrations

Every migration file is wrapped in `BEGIN`/`COMMIT` so it runs atomically. If a statement fails the whole migration rolls back automatically.

Every migration has a matching rollback script in `rollbacks/<timestamp>_rollback.sql` that drops everything the migration created, in reverse dependency order. Run the rollback manually in the Supabase SQL editor if you need to undo an applied migration.

**Never edit an applied migration.** Create a new migration instead.
