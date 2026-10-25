const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const prisma = new PrismaClient();

async function main() {
  const names = [
    "20261022100000_location_matching_index",
    "20261024030000_add_blood_request_idempotency",
  ];

  const rows = await prisma.$queryRaw`
    SELECT migration_name, checksum, finished_at, rolled_back_at
    FROM "_prisma_migrations"
    WHERE migration_name IN (
      '20261022100000_location_matching_index',
      '20261024030000_add_blood_request_idempotency'
    )
    ORDER BY migration_name
  `;

  for (const name of names) {
    const file = path.join("prisma", "migrations", name, "migration.sql");
    const local = crypto
      .createHash("sha256")
      .update(fs.readFileSync(file))
      .digest("hex");

    const row = rows.find(r => r.migration_name === name);

    console.log(`\nMigration: ${name}`);
    console.log(`Local SHA-256:    ${local}`);
    console.log(`Database checksum: ${row ? row.checksum : "NOT FOUND"}`);
    console.log(`Finished: ${row?.finished_at ?? "NOT APPLIED"}`);
    console.log(`Rolled back: ${row?.rolled_back_at ?? "No"}`);
    console.log(`Match: ${row ? local === row.checksum : false}`);
  }
}

main()
  .catch(e => {
    console.error("Checksum inspection failed:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
