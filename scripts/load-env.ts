// Load .env / .env.local the same way Next.js does. Import this first: modules like
// lib/server/connection read process.env when they're evaluated.
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
