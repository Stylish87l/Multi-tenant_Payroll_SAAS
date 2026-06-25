import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // 🚀 Uses the built-in type-safe helper instead of raw process.env
    url: env("DATABASE_URL"),
  },
  migrations: {
    path: "prisma/migrations",
    // 🛠️ Removed the problematic '--env-file=.env' flags so it works perfectly in cloud containers
    seed: "node prisma/seed.js",
  },
});