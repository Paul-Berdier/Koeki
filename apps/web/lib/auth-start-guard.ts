/** Only a trusted server-configured origin can initiate a browser authentication POST. */
export function trustedAuthOrigin(value: string | undefined, production = process.env.NODE_ENV === "production"): string | null {
  try {
    if (!value) return null;
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.protocol !== "https:" && (production || url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) return null;
    return url.origin;
  } catch { return null; }
}

export function sameOriginAuthPost(headers: Headers, origin: string): boolean {
  // A native POST sends Origin even without JavaScript. Fail closed if missing,
  // opaque, same-site-but-cross-origin, or contradictory to Fetch Metadata.
  const site = headers.get("sec-fetch-site");
  return headers.get("origin") === origin && (site === null || site === "same-origin");
}

/** Bounded URL-encoded body; never process files or attacker-sized multipart forms. */
export async function readAuthStartForm(request: Request): Promise<URLSearchParams | null> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/x-www-form-urlencoded") return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const data = new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (data.getAll("intent").length !== 1 || data.getAll("token").length > 1) return null;
    if ([...data.keys()].some((key) => key !== "intent" && key !== "token")) return null;
    return data;
  } catch { return null; }
  finally { reader.releaseLock(); }
}
