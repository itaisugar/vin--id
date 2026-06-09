import { NextResponse } from "next/server";

/**
 * Minimal, public health check. Returns a constant JSON body — NO secrets, NO
 * env values, NO database access. Useful for uptime pings and confirming the
 * deployment is live and routing works.
 */
export const dynamic = "force-static";

export function GET() {
  return NextResponse.json({ ok: true, app: "Vin.ID" });
}
