-- A ninja must stay invitable after a revoked or expired invitation:
-- the uniqueness of pending invitations is enforced in application code.
DROP INDEX "Invitation_ninjaProfileId_key";
CREATE INDEX "Invitation_ninjaProfileId_idx" ON "Invitation"("ninjaProfileId");
