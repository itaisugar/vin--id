/**
 * Shared brand artwork for the generated app icons (apple-icon / icon).
 *
 * A white tire / alloy-wheel mark centered on the brand-blue gradient. The
 * wheel is supplied as an inline SVG data URI so Satori (next/og) renders it
 * crisply at any size; `encodeURIComponent` keeps the `#` colour hashes valid
 * inside the data URI.
 */

const tireSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <g fill="none" stroke="#ffffff" stroke-linecap="round">
    <circle cx="100" cy="100" r="86" stroke-width="16" stroke-dasharray="14 10"/>
    <circle cx="100" cy="100" r="70" stroke-width="6"/>
    <circle cx="100" cy="100" r="52" stroke-width="6"/>
    <g stroke-width="9">
      <line x1="100" y1="100" x2="100" y2="48"/>
      <line x1="100" y1="100" x2="149.45" y2="84.55"/>
      <line x1="100" y1="100" x2="130.57" y2="142.05"/>
      <line x1="100" y1="100" x2="69.43" y2="142.05"/>
      <line x1="100" y1="100" x2="50.55" y2="84.55"/>
    </g>
  </g>
  <circle cx="100" cy="100" r="16" fill="#ffffff"/>
  <circle cx="100" cy="100" r="7" fill="#2563eb"/>
</svg>`;

const tireDataUri = `data:image/svg+xml,${encodeURIComponent(tireSvg)}`;

export function BrandIconArt({ size }: { size: number }) {
  const wheel = Math.round(size * 0.74);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={tireDataUri} width={wheel} height={wheel} alt="" />
    </div>
  );
}
