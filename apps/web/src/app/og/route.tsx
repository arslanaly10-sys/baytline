import { ImageResponse } from "next/og";
import { MARK_PATHS } from "@/components/ui/BrandMark";
import { getDictionary } from "@/i18n";

// Share card for the marketing pages, served at /og and referenced by siteMeta(). The bundled font has no Arabic glyphs, so the card text
// and its alt text are English in both locales.
const size = { width: 1200, height: 630 };

export async function GET() {
  const en = await getDictionary("en");
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#0a0f14", color: "#efe6d3" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="88" height="88" viewBox="0 0 64 64">
            <path d={MARK_PATHS.bowl} fill="none" stroke="#c9a24a" strokeWidth="4" strokeLinecap="round" />
            <path d={MARK_PATHS.towers} fill="#c9a24a" />
            <circle cx={MARK_PATHS.sun.cx} cy={MARK_PATHS.sun.cy} r={MARK_PATHS.sun.r} fill="#e8c97f" />
          </svg>
          <div style={{ fontSize: 44, fontWeight: 600 }}>{en.brand.name}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 72, lineHeight: 1.05, maxWidth: 950 }}>{en.site.film.c1.title}</div>
          <div style={{ fontSize: 30, color: "#a3abb3", maxWidth: 900 }}>{en.site.film.c1.body}</div>
        </div>
        <div style={{ display: "flex", height: 6, width: 160, background: "#c9a24a" }} />
      </div>
    ),
    { ...size, headers: { "cache-control": "public, max-age=86400, immutable" } },
  );
}
