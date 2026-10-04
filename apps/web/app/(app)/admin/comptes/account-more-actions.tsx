"use client";

import { useEffect, useId, useState, type ReactNode } from "react";

export function AccountMoreActions({ children }: { children: ReactNode }) {
  const panelId = useId();
  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <div className="account-more-actions">
      <button
        type="button"
        disabled={!hydrated}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        Autres actions
      </button>
      <div id={panelId} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
