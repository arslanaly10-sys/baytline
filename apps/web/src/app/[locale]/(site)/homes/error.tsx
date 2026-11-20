"use client";

import { useParams } from "next/navigation";

/** Shown when listings fail to load. The two strings are inlined so the error page needs no data (they mirror cx.search.error/retry). */
export default function HomesError({ reset }: { error: Error; reset: () => void }) {
  const { locale } = useParams<{ locale: string }>();
  const ar = locale === "ar";
  const t = ar ? { error: "تعذّر تحميل المنازل الآن. حاول بعد قليل.", retry: "حاول مرة أخرى" } : { error: "We couldn't load homes just now. Try again in a moment.", retry: "Try again" };
  return (
    <main id="main" className="bg-night text-sand">
      <div className="mx-auto max-w-3xl px-4 pb-24 pt-40 text-center sm:px-8">
        <p role="alert" className="text-lg">{t.error}</p>
        <button type="button" onClick={reset} className="mt-6 rounded-full bg-gold px-5 py-2.5 text-sm font-medium text-night hover:bg-gold-light">{t.retry}</button>
      </div>
    </main>
  );
}
