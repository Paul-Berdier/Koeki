export async function GET() {
  let database: "ok" | "unreachable" = "unreachable";
  const demo = process.env.DEMO_MODE === "true";
  if (!demo) {
    try {
      const { prisma } = await import("@koeki/database");
      await prisma.$queryRaw`SELECT 1`;
      database = "ok";
    } catch { database = "unreachable"; }
  }
  const healthy = demo || database === "ok";
  return Response.json(
    {
      status: healthy ? "ok" : "error",
      database: demo ? "demo" : database,
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
