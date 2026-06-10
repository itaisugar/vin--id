import { ImageResponse } from "next/og";
import { BrandIconArt } from "@/lib/brand-icon";

// High-resolution app icon used for the PWA manifest (Android install /
// standalone) and as a crisp browser icon. The centered mark stays well within
// the maskable safe zone, so it survives Android's circular crop.
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<BrandIconArt size={size.width} />, { ...size });
}
