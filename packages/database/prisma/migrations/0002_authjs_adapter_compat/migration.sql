-- Align the auth tables with the fields the @auth/prisma-adapter writes.

-- AlterTable: User gains the standard Auth.js emailVerified field
ALTER TABLE "User" ADD COLUMN "emailVerified" TIMESTAMP(3);

-- AlterTable: Account OAuth token columns use the adapter's snake_case names
ALTER TABLE "Account" RENAME COLUMN "refreshToken" TO "refresh_token";
ALTER TABLE "Account" RENAME COLUMN "accessToken" TO "access_token";
ALTER TABLE "Account" RENAME COLUMN "expiresAt" TO "expires_at";
ALTER TABLE "Account" RENAME COLUMN "tokenType" TO "token_type";
ALTER TABLE "Account" RENAME COLUMN "idToken" TO "id_token";
ALTER TABLE "Account" RENAME COLUMN "sessionState" TO "session_state";

-- AlterTable: Session.sessionVersion gets a default so the adapter can create sessions
ALTER TABLE "Session" ALTER COLUMN "sessionVersion" SET DEFAULT 1;
