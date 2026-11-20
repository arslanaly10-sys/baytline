import { PHOTOS, type PhotoSlug } from "@/lib/photos";

type Props = { slug: PhotoSlug; alt: string; sizes: string; className?: string; ratio?: string; priority?: boolean };

/** A licensed photograph in a fixed-ratio frame. It zooms slightly on hover, inside its frame. */
export function Photo({ slug, alt, sizes, className = "", ratio = "4 / 3", priority }: Props) {
  const p = PHOTOS[slug];
  const largest = p.widths[p.widths.length - 1]!;
  return (
    <div className={`group/photo overflow-hidden bg-panel ${className}`} style={{ aspectRatio: ratio }}>
      <img
        src={`/photos/${slug}-${largest}.webp`}
        srcSet={p.widths.map((w) => `/photos/${slug}-${w}.webp ${w}w`).join(", ")}
        sizes={sizes}
        width={p.width}
        height={p.height}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        style={p.focus ? { objectPosition: p.focus } : undefined}
        className="h-full w-full object-cover transition-transform duration-200 ease-out group-hover/photo:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover/photo:scale-100"
      />
    </div>
  );
}
