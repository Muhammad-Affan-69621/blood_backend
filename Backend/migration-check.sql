SELECT migration_name, checksum, finished_at
FROM "_prisma_migrations"
WHERE migration_name IN (
  '20261022100000_location_matching_index',
  '20261024030000_add_blood_request_idempotency'
)
ORDER BY migration_name;
