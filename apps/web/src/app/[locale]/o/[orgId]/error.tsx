"use client";

import { useParams } from "next/navigation";
import { useEffect } from "react";

/** Error state for workspace pages. Error details stay in the server log, never on screen. */
const TEXT = {
  en: { title: "This page couldn't load", body: "Something went wrong on our side. Your data wasn't changed.", retry: "Try again" },
  ar: { title: "تعذّر تحميل هذه الصفحة", body: "حدثت مشكلة لدينا. لم تتغير بياناتك.", retry: "حاول مرة أخرى" },
};

export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { locale } = useParams<{ locale: string }>();
  const t = locale === "ar" ? TEXT.ar : TEXT.en;
  useEffect(() => {
    if (error.digest) console.warn("workspace error", error.digest);
  }, [error.digest]);
  return (
    <section role="alert" className="rounded-panel border-2 border-coral bg-surface px-6 py-10 text-center">
      <h2 className="text-lg">{t.title}</h2>
      <p className="mx-auto mt-2 max-w-[50ch] text-sm text-ink-muted">{t.body}</p>
      {error.digest && <p className="mt-2 text-xs text-ink-muted" dir="ltr">ref {error.digest}</p>}
      <button type="button" onClick={reset} className="mt-5 rounded-control bg-gulf px-4 py-2 text-sm font-medium text-gulf-ink hover:bg-gulf-strong">
        {t.retry}
      </button>
    </section>
  );
}
