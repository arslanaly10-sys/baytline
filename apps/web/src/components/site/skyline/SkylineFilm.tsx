"use client";

import { useEffect, useRef, useState } from "react";
import type { SkylineScene } from "./scene";
import type { AmbientSound } from "./sound";

export type FilmText = {
  chapters: { title: string; body: string }[]; // c1..c4
  finale: { title: string; cta: string; secondary: string };
  previewLabel: string;
  preview: { title: string; units: string; available: string; reserved: string; enquiries: string; next: string; a1: string; a2: string; a3: string };
  sound: { on: string; off: string };
  skip: string;
  ctaHref: string;
  secondaryHref: string;
};

/** Visibility windows for chapters c1..c4 and the finale, in film progress (0..1). */
const WINDOWS: [number, number][] = [
  [-1, 0.14],
  [0.2, 0.36],
  [0.43, 0.57],
  [0.63, 0.78],
];
const FINALE_FROM = 0.86;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
const windowOpacity = ([a, b]: [number, number], p: number) => (a < 0 ? 1 : smooth(a - 0.05, a, p)) * (1 - smooth(b, b + 0.05, p));

type Mode = "loading" | "film" | "still" | "flat";

export function SkylineFilm({ t }: { t: FilmText }) {
  const section = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const chapters = useRef<(HTMLDivElement | null)[]>([]);
  const finale = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SkylineScene | null>(null);
  const soundRef = useRef<AmbientSound | null>(null);
  const [mode, setMode] = useState<Mode>("loading");
  const [soundOn, setSoundOn] = useState(false);

  useEffect(() => {
    let disposed = false;
    const cleanups: (() => void)[] = [];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    (async () => {
      const [{ SkylineScene, webglAvailable }, gsapMod, stMod] = await Promise.all([
        import("./scene"),
        import("gsap"),
        import("gsap/ScrollTrigger"),
      ]);
      if (disposed || !canvas.current || !section.current) return;
      if (!webglAvailable()) return setMode("flat");

      const small = window.innerWidth < 768;
      const scene = new SkylineScene(canvas.current, { lowPower: small || (navigator.hardwareConcurrency ?? 8) <= 4 });
      sceneRef.current = scene;
      const fit = () => {
        const el = canvas.current!;
        scene.resize(el.clientWidth, el.clientHeight);
      };
      fit();
      window.addEventListener("resize", fit);
      cleanups.push(() => window.removeEventListener("resize", fit), () => scene.dispose());

      if (reduced) {
        // A still, styled frame of the night city; no motion at all.
        scene.renderStill(0.9);
        return setMode("still");
      }
      setMode("film");

      const gsap = gsapMod.gsap;
      const ScrollTrigger = stMod.ScrollTrigger;
      gsap.registerPlugin(ScrollTrigger);
      const st = ScrollTrigger.create({
        trigger: section.current,
        start: "top top",
        end: "bottom bottom",
        onUpdate: (self) => {
          const p = self.progress;
          scene.setProgress(p);
          chapters.current.forEach((el, i) => {
            if (!el) return;
            const o = windowOpacity(WINDOWS[i]!, p);
            el.style.opacity = String(o);
            el.style.transform = `translateY(${(1 - o) * 24}px)`;
            el.style.visibility = o < 0.01 ? "hidden" : "visible";
          });
          if (finale.current) {
            const o = smooth(FINALE_FROM - 0.05, FINALE_FROM + 0.03, p);
            finale.current.style.opacity = String(o);
            finale.current.style.transform = `translateY(${(1 - o) * 40}px)`;
            finale.current.style.visibility = o < 0.01 ? "hidden" : "visible";
          }
          soundRef.current?.setNight(scene.nightLevel);
        },
      });
      cleanups.push(() => st.kill());

      // Render only while the film is on screen.
      const io = new IntersectionObserver(([e]) => (e?.isIntersecting ? scene.start() : scene.stop()), { rootMargin: "100px" });
      io.observe(section.current);
      cleanups.push(() => io.disconnect());

      const onPointer = (e: PointerEvent) => scene.setPointer((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
      window.addEventListener("pointermove", onPointer, { passive: true });
      cleanups.push(() => window.removeEventListener("pointermove", onPointer));
    })();

    return () => {
      disposed = true;
      cleanups.forEach((c) => c());
      soundRef.current?.dispose();
      soundRef.current = null;
    };
  }, []);

  async function toggleSound() {
    if (soundOn) {
      soundRef.current?.stop();
      setSoundOn(false);
      return;
    }
    if (!soundRef.current) {
      const { AmbientSound } = await import("./sound");
      soundRef.current = new AmbientSound();
    }
    soundRef.current.start();
    soundRef.current.setNight(sceneRef.current?.nightLevel ?? 0);
    setSoundOn(true);
  }

  const animated = mode === "film" || mode === "loading";

  return (
    <section
      ref={section}
      aria-label={t.finale.title}
      className="relative"
      style={{ height: animated ? "600vh" : "auto" }}
    >
      <div className={animated ? "sticky top-0 h-dvh overflow-hidden" : "relative min-h-dvh overflow-hidden"}>
        <canvas ref={canvas} aria-hidden="true" className={`absolute inset-0 h-full w-full ${mode === "flat" ? "hidden" : ""}`} />
        {mode === "flat" && <FlatPoster />}
        {/* Scrims keep text legible over any frame of the film. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(10,15,20,0.8),rgba(10,15,20,0.25)_16%,transparent_32%,transparent_45%,rgba(10,15,20,0.7)_68%,rgba(10,15,20,0.95))]" />

        <a href={t.secondaryHref} className="absolute end-4 top-20 z-20 rounded-control bg-night/70 px-3 py-1.5 text-xs text-mist underline-offset-4 backdrop-blur hover:text-sand hover:underline sm:end-8">
          {t.skip}
        </a>

        {animated ? (
          <>
            {t.chapters.map((c, i) => (
              <div
                key={i}
                ref={(el) => {
                  chapters.current[i] = el;
                }}
                className="absolute inset-x-0 bottom-[14vh] z-10 mx-auto max-w-3xl px-6 text-center will-change-transform"
                style={{ opacity: i === 0 ? 1 : 0, visibility: i === 0 ? "visible" : "hidden" }}
              >
                {i === 0 ? (
                  <h1 className="font-display text-[clamp(2.4rem,6vw,4.6rem)] font-medium leading-[1.05] text-sand">{c.title}</h1>
                ) : (
                  <h2 className="font-display text-[clamp(2rem,5vw,3.8rem)] font-medium leading-[1.08] text-sand">{c.title}</h2>
                )}
                <p className="mx-auto mt-4 max-w-[46ch] text-base text-sand/80 sm:text-lg">{c.body}</p>
              </div>
            ))}
            <Finale t={t} innerRef={finale} hidden />
          </>
        ) : (
          <div className="relative z-10 flex min-h-dvh flex-col justify-end gap-10 px-6 pb-16 pt-32">
            <h1 className="mx-auto max-w-3xl text-center font-display text-[clamp(2.2rem,5vw,4rem)] font-medium leading-[1.08]">{t.finale.title}</h1>
            <ol className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {t.chapters.map((c, i) => (
                <li key={i} className="rounded-panel border border-hairline bg-night/70 p-4 backdrop-blur">
                  <p className="font-display text-xl text-gold-light">{c.title}</p>
                  <p className="mt-1 text-sm text-sand/80">{c.body}</p>
                </li>
              ))}
            </ol>
            <Finale t={t} />
          </div>
        )}

        {mode === "film" && (
          <button
            type="button"
            onClick={toggleSound}
            aria-pressed={soundOn}
            className="absolute bottom-5 start-5 z-20 flex items-center gap-2 rounded-full border border-hairline bg-night/70 px-3.5 py-2 text-xs text-sand backdrop-blur hover:border-gold"
          >
            <SoundIcon on={soundOn} />
            {soundOn ? t.sound.off : t.sound.on}
          </button>
        )}
      </div>
    </section>
  );
}

function Finale({ t, innerRef, hidden }: { t: FilmText; innerRef?: React.Ref<HTMLDivElement>; hidden?: boolean }) {
  return (
    <div
      ref={innerRef}
      className={hidden ? "absolute inset-x-0 bottom-[6vh] z-10 mx-auto max-w-5xl px-6 will-change-transform" : "relative z-10 mx-auto w-full max-w-5xl"}
      style={hidden ? { opacity: 0, visibility: "hidden" } : undefined}
    >
      <div className="grid items-end gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-8">
        <div className={hidden ? "rounded-3xl bg-night/75 p-5 backdrop-blur-sm lg:bg-transparent lg:p-0 lg:backdrop-blur-none" : ""}>
          {hidden && <p className="font-display text-[clamp(1.8rem,3.6vw,3rem)] font-medium leading-[1.1] text-sand">{t.finale.title}</p>}
          <div className="mt-6 flex flex-wrap gap-3">
            <a href={t.ctaHref} className="rounded-full bg-gold px-6 py-3 text-sm font-medium text-night transition-colors hover:bg-gold-light">
              {t.finale.cta}
            </a>
            <a href={t.secondaryHref} className="rounded-full border border-sand/30 px-6 py-3 text-sm text-sand hover:border-gold-light">
              {t.finale.secondary}
            </a>
          </div>
        </div>
        <AppPreview t={t} />
      </div>
    </div>
  );
}

/** An illustration of the app, rising out of the night city. Sample values, labelled as such. */
function AppPreview({ t }: { t: FilmText }) {
  const p = t.preview;
  return (
    <figure className="rounded-[18px] border border-gold/30 bg-night-2/80 p-4 shadow-[0_30px_80px_-20px_rgba(201,162,74,0.25)] backdrop-blur-md">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-sand">{p.title}</span>
        <figcaption className="rounded-full border border-dashed border-mist/60 px-2 py-0.5 text-[11px] text-mist">{t.previewLabel}</figcaption>
      </div>
      <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
        {[
          [p.units, "128"],
          [p.available, "41"],
          [p.reserved, "9"],
          [p.enquiries, "23"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-panel px-2 py-2.5">
            <dd className="font-display text-2xl text-gold-light tabular-nums">{v}</dd>
            <dt className="text-[11px] text-mist">{k}</dt>
          </div>
        ))}
      </dl>
      <p className="mt-3 hidden text-xs text-mist sm:block">{p.next}</p>
      <ul className="mt-1.5 hidden space-y-1.5 text-sm sm:block">
        {[p.a1, p.a2, p.a3].map((a) => (
          <li key={a} className="flex items-center gap-2 rounded-lg bg-panel px-3 py-2 text-sand/90">
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-gold" />
            {a}
          </li>
        ))}
      </ul>
    </figure>
  );
}

function FlatPoster() {
  // Fallback when WebGL isn't available: a drawn night skyline.
  return (
    <svg aria-hidden="true" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMax slice" viewBox="0 0 1200 800">
      <defs>
        <linearGradient id="flat-sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#04070d" />
          <stop offset="0.75" stopColor="#18223a" />
          <stop offset="1" stopColor="#3a2a24" />
        </linearGradient>
      </defs>
      <rect width="1200" height="800" fill="url(#flat-sky)" />
      <path d="M0 800V620h70v-40h50v-90h40v90h60v-160h50v160h40v-60h70v-230h12l8-60 8 60h12v230h60v-120h80v120h50v-70h60v-180h60v180h40v-90h70v90h60v-50h80v50h40v-130h60v130h60v180z" fill="#0b1118" />
      <path d="M0 800V700h1200v100z" fill="#120f0c" />
    </svg>
  );
}

function SoundIcon({ on }: { on: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 10v4h4l5 4V6L8 10z" fill="currentColor" stroke="none" />
      {on ? <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" /> : <path d="M16 9l5 6M21 9l-5 6" />}
    </svg>
  );
}
