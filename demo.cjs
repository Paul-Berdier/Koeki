// Lance le build de production en mode démonstration (aucune base requise, écritures
// désactivées) — utilisé pour l'audit visuel local. Jamais utilisé en production.
process.env.DEMO_MODE = "true";
process.env.AUTH_SECRET = process.env.AUTH_SECRET || "demo-secret-not-for-prod";
process.env.DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "demo";
process.env.DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || "demo";
process.argv = [process.argv[0], "next", "start", "apps/web", "-p", "3005"];
require("./apps/web/node_modules/next/dist/bin/next");
