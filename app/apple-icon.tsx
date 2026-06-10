import { ImageResponse } from "next/og";
import { BrandIconArt } from "@/lib/brand-icon";

// Apple touch icon used by iOS when adding the app to the Home Screen.
// 180×180 is the size iOS expects; the OS applies its own rounded mask, so we
// fill the whole square (full-bleed) with the brand background.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<BrandIconArt size={size.width} />, { ...size });
}
