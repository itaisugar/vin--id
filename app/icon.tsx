import { ImageResponse } from "next/og";

// High-resolution app icon used for the PWA manifest (Android install /
// standalone) and as a crisp browser icon. The centered mark stays well within
// the maskable safe zone, so it survives Android's circular crop.
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
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
          fontSize: 300,
          fontWeight: 800,
          letterSpacing: "-0.06em",
          fontFamily: "sans-serif",
        }}
      >
        V
        <span style={{ color: "#bfdbfe", marginLeft: 6 }}>.</span>
      </div>
    ),
    { ...size },
  );
}
