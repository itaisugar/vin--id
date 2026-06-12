/**
 * Copy text to the clipboard as reliably as possible across browsers.
 *
 * Tries the async Clipboard API first (requires a secure context + permission),
 * then falls back to a temporary off-screen `<textarea>` + `execCommand("copy")`
 * for older/mobile browsers (e.g. iOS Safari without clipboard-write). Returns
 * `true` on success, `false` if every strategy failed. Never throws.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard?.writeText
    ) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied / insecure context — fall through to the legacy path.
  }

  try {
    if (typeof document === "undefined") return false;
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    // Keep it off-screen but focusable so the selection/copy works on mobile.
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
