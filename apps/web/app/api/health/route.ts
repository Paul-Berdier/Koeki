export async function GET() {
  let database: "ok" | "unreachable" = "unreachable";
  if (process.env.DEMO_MODE !== "true") {
    try {
      const { prisma } = await import("@koeki/database");
      await prisma.$queryRaw`SELECT 1`;
      database = "ok";
    } catch { database = "unreachable"; }
  }
  return Response.json(
    {
      status: "ok",
      database: process.env.DEMO_MODE === "true" ? "demo" : database,
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
