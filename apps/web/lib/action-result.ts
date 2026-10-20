/** Serializable outcome for mutations followed by a fresh document navigation. */
export type RedirectActionResult = { error: string } | { redirectTo: string };
