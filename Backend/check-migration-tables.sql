SELECT
    table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
      'users',
      'refresh_tokens',
      'password_reset_tokens',
      '_prisma_migrations'
  )
ORDER BY table_name;
