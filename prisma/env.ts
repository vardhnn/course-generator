// Evaluated before any app module when imported first from seed.ts (ES module
// dependencies evaluate in import order), so DATABASE_URL exists by the time
// src/lib/prisma constructs its PrismaClient at module scope.
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
