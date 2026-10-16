"use client";

import { useEffect, useState } from "react";

const KEY = "novara-cookie-choice";

export function CookieConsent() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setOpen(true);
    } catch {
      setOpen(true);
    }
  }, []);

  function choose(value) {
    try {
      localStorage.setItem(KEY, value);
    } catch {
      /* preview can still close if storage is blocked */
    }
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div className="cookie" role="dialog" aria-labelledby="cookie-title" aria-describedby="cookie-body">
      <p id="cookie-title">Cookies on this preview</p>
      <p id="cookie-body">
        Essential cookies keep the page working. Optional cookies help us see which sections people use. We do not sell this information.
      </p>
      <div className="cookie-actions">
        <button type="button" className="btn btn-ghost" onClick={() => choose("essential")}>Essential only</button>
        <button type="button" className="btn btn-primary" onClick={() => choose("all")}>Accept</button>
      </div>
    </div>
  );
}
