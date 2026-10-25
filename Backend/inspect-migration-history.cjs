const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const tables = await prisma.$queryRaw`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('users', 'refresh_tokens', 'password_reset_tokens', '_prisma_migrations')
    ORDER BY table_name
  `;

  console.log('Database tables:', tables);

  const historyTable = tables.some(row => row.table_name === '_prisma_migrations');

  if (historyTable) {
    const migrations = await prisma.$queryRaw`
      SELECT migration_name, finished_at, rolled_back_at, logs
      FROM "_prisma_migrations"
      ORDER BY started_at
    `;

    console.log('Migration history:', migrations);
  } else {
    console.log('No _prisma_migrations table exists.');
  }
}

main()
  .catch(error => {
    console.error('Read-only inspection failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
