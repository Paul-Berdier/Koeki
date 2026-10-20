"use client";

import type { ComponentProps } from "react";
import { ActionForm } from "@/components/action-form";
import type { RedirectActionResult } from "@/lib/action-result";

/** Finish the mutation before navigating; never replay a POST to recover a view. */
export function RedirectActionForm({ action, ...props }: Omit<ComponentProps<typeof ActionForm>, "action"> & {
  action: (data: FormData) => Promise<RedirectActionResult>;
}) {
  return <ActionForm {...props} action={async (data) => {
    const result = await action(data);
    if ("error" in result) return result;
    // A document GET clears the visited-route cache and the previous form's
    // pending transition, and obtains a fresh CSP nonce from middleware.
    window.location.assign(result.redirectTo);
  }} />;
}
