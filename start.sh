# 1) 启动 PostgreSQL（如已启动会提示已存在进程）
  pg_ctl -D /usr/local/var/postgresql@14 -l /usr/local/var/log/postgresql@14.log start || true

  # 2) 确认数据库可用
  psql -d postgres -c "SELECT version();"

  # 3) 确保 .env 存在
  cp -n .env.example .env

  # 4) 确保数据库存在（不存在才创建）
  psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='clawshopping'" | rg -q '^1$' || \
  psql -d postgres -c "CREATE DATABASE clawshopping OWNER postgres;"

  # 5) 应用 schema
  DATABASE_URL=postgres://postgres:postgres@localhost:5432/clawshopping pnpm db:push

  # 6) 启动项目
  pnpm dev

  停止 PostgreSQL：

  pg_ctl -D /usr/local/var/postgresql@14 stop
