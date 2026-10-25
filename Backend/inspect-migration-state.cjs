const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const columns = await prisma.$queryRaw`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'blood_requests'
      AND column_name IN ('idempotency_key', 'request_payload_hash')
    ORDER BY column_name
  `;

  const indexes = await prisma.$queryRaw`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'locations'
      AND indexname = 'locations_geography_gist_idx'
  `;

  const history = await prisma.$queryRaw`
    SELECT migration_name, started_at, finished_at, rolled_back_at,
           applied_steps_count, logs
    FROM "_prisma_migrations"
    WHERE migration_name IN (
      '20261022100000_location_matching_index',
      '20261024030000_add_blood_request_idempotency'
    )
    ORDER BY migration_name, started_at
  `;

  console.log("IDEMPOTENCY COLUMNS:", JSON.stringify(columns));
  console.log("SPATIAL INDEX:", JSON.stringify(indexes));
  console.log("MIGRATION HISTORY:");
  for (const row of history) {
    console.log(JSON.stringify({
      migration_name: row.migration_name,
      started_at: row.started_at,
      finished_at: row.finished_at,
      rolled_back_at: row.rolled_back_at,
      applied_steps_count: row.applied_steps_count,
      logs: row.logs
    }));
  }
}

main()
  .catch(e => {
    console.error("Diagnostic failed:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
