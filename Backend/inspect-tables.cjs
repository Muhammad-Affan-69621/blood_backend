const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$queryRaw`
    SELECT
      to_regclass('public.users')::text AS users_table,
      to_regclass('public.refresh_tokens')::text AS refresh_tokens_table,
      to_regclass('public.password_reset_tokens')::text AS password_reset_tokens_table,
      to_regclass('public._prisma_migrations')::text AS migrations_table
  `;

  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
