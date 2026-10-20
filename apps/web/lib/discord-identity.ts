export interface DiscordIdentity {
  discordId: string | null;
  accounts: readonly { providerAccountId: string }[];
}

/** A display name or an email is never evidence of account ownership.
 * Legacy/bootstrap users may have no OAuth link; conflicting links fail closed.
 * getUserByAccount separately requires the queried account to be this sole link. */
export function hasConsistentDiscordIdentity(identity: DiscordIdentity): boolean {
  if (identity.accounts.length > 1) return false;
  const account = identity.accounts[0];
  if (!account) return identity.discordId === null;
  return identity.discordId === null || identity.discordId === account.providerAccountId;
}

export function ownsDiscordIdentity(identity: DiscordIdentity, providerAccountId: string): boolean {
  return hasConsistentDiscordIdentity(identity)
    && identity.accounts.length === 1
    && identity.accounts[0]?.providerAccountId === providerAccountId;
}
