import { notFound } from "next/navigation";

/** Routes unmatched URLs under a locale to [locale]/not-found. */
export default function CatchAll() {
  notFound();
}
