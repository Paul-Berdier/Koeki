import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
export function createInvitationToken(pepper: string) { const token = randomBytes(32).toString("base64url"); return { token, tokenHash: hashInvitationToken(token, pepper) }; }
export function hashInvitationToken(token: string, pepper: string) { return createHash("sha256").update(`${pepper}:${token}`, "utf8").digest("hex"); }
export function verifyInvitationToken(token: string, expectedHash: string, pepper: string) { const actual = Buffer.from(hashInvitationToken(token, pepper)); const expected = Buffer.from(expectedHash); return actual.length === expected.length && timingSafeEqual(actual, expected); }
