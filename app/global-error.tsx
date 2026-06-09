"use client";

import { useEffect } from "react";

// Last-resort handler for errors in the root layout itself. It REPLACES the
// root layout (and the i18n provider), so it renders its own <html>/<body> and
// uses plain text — keep it minimal and dependency-free.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "1.5rem",
        }}
      >
        <div>
          <p style={{ fontWeight: 600 }}>Something went wrong</p>
          <p style={{ color: "#666", fontSize: "0.875rem", marginTop: "0.25rem" }}>
            Please try again. If the problem continues, reload the page.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1rem",
              height: "2.5rem",
              padding: "0 1rem",
              borderRadius: "0.375rem",
              border: "1px solid #ccc",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
