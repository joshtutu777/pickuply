"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f7f4ee", color: "#1c1915", fontFamily: "Georgia, serif" }}>
        <main style={{ maxWidth: "36rem", margin: "0 auto", padding: "2rem 1rem" }}>
          <h1 style={{ fontSize: "2rem", lineHeight: 1.2 }}>This page couldn’t load</h1>
          <p style={{ fontSize: "1.125rem", lineHeight: 1.5 }}>Reload to try again, or go back.</p>
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem" }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ minHeight: "3rem", padding: "0 1rem", fontSize: "1rem" }}
            >
              Reload
            </button>
            <button
              type="button"
              onClick={() => window.history.back()}
              style={{ minHeight: "3rem", padding: "0 1rem", fontSize: "1rem" }}
            >
              Go back
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
