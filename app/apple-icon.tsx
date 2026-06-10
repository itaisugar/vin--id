import { ImageResponse } from "next/og";

// Apple touch icon used by iOS when adding the app to the Home Screen.
// 180×180 is the size iOS expects; the OS applies its own rounded mask, so we
// fill the whole square (full-bleed) with the brand background.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
          color: "#ffffff",
          fontSize: 112,
          fontWeight: 800,
          letterSpacing: "-0.06em",
          fontFamily: "sans-serif",
        }}
      >
        V
        <span style={{ color: "#bfdbfe", marginLeft: 2 }}>.</span>
      </div>
    ),
    { ...size },
  );
}
