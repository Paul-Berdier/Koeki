import { z } from "zod";
export const serverEnvSchema = z.object({ DATABASE_URL: z.string().url(), AUTH_SECRET: z.string().min(32), APP_URL: z.string().url(), DISCORD_CLIENT_ID: z.string().min(1), DISCORD_CLIENT_SECRET: z.string().min(1), DISCORD_GUILD_ID: z.string().min(1), INVITE_TOKEN_PEPPER: z.string().min(16), INTERNAL_CRON_SECRET: z.string().min(16) });
