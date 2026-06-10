import "server-only";

import sharp from "sharp";
import { getVehicleById } from "@/lib/vehicles/service";
import { getExtractionProvider } from "./provider";
import {
  type ScanExtractionResponse,
  type ScanImageMime,
} from "./types";

/**
 * Orchestrates the scan → extract step. Downscales the image server-side (to
 * control token cost), then hands a base64 image block to the active provider.
 * The raw scan is processed in memory and is NOT persisted — only the user-
 * confirmed record (created later via the existing maintenance/issue flow) is.
 */

export class VehicleNotFoundError extends Error {
  constructor() {
    super("Vehicle not found");
    this.name = "VehicleNotFoundError";
  }
}

/** Longest-edge cap for the downscaled image (px). Keeps token cost bounded. */
const MAX_EDGE = 1500;

/**
 * Verify ownership of the vehicle, downscale the image, and run extraction.
 * Throws VehicleNotFoundError if the vehicle is not the user's; lets provider
 * errors propagate so the action can fall back to manual entry.
 */
export async function extractFromScan(
  vehicleId: string,
  image: { buffer: Buffer; mimeType: ScanImageMime },
  locale?: string,
): Promise<ScanExtractionResponse> {
  // Ownership: getVehicleById is owner-scoped (returns null if not the user's).
  const vehicle = await getVehicleById(vehicleId);
  if (!vehicle) throw new VehicleNotFoundError();

  // Downscale + normalize to JPEG. `.rotate()` applies EXIF orientation so the
  // model sees the image upright.
  const downscaled = await sharp(image.buffer)
    .rotate()
    .resize({
      width: MAX_EDGE,
      height: MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80 })
    .toBuffer();

  const provider = getExtractionProvider();
  const extraction = await provider.extract({
    imageBase64: downscaled.toString("base64"),
    mediaType: "image/jpeg",
    locale,
  });

  return { extraction, engine: provider.engine };
}
