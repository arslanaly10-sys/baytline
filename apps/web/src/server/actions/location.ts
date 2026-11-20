"use server";

import { revalidatePath } from "next/cache";
import { archivePlace, createPlace, importPlaces, saveLocation, updatePlace, verifyLocation, verifyPlace } from "@baytline/developer";
import type { FormState } from "@/lib/form-state";
import { format } from "@/i18n/format";
import { getDb } from "../db";
import { failed, localeAndDict, requireActor, str } from "./helpers";

// Actor from the session; @baytline/developer re-checks membership, permission and project ownership.

type D = Awaited<ReturnType<typeof localeAndDict>>["dict"];
async function run(fd: FormData, fn: (actor: Awaited<ReturnType<typeof requireActor>>, dict: D) => Promise<string>): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  const actor = await requireActor(locale, str(fd, "orgId"));
  try {
    const message = await fn(actor, dict);
    revalidatePath(`/${locale}/o/${actor.orgId}`, "layout");
    revalidatePath(`/${locale}/homes`, "layout");
    return { status: "success", message };
  } catch (e) {
    return failed(e, dict.loc.errors);
  }
}

const placeInput = (fd: FormData) => ({
  kind: str(fd, "kind"), category: str(fd, "category"), name: str(fd, "name"), description: str(fd, "description"),
  latitude: str(fd, "latitude"), longitude: str(fd, "longitude"), distanceKm: str(fd, "distanceKm"), stage: str(fd, "stage"),
  expectedDate: str(fd, "expectedDate"), developerName: str(fd, "developerName"), sourceKind: str(fd, "sourceKind"), sourceReference: str(fd, "sourceReference"),
});

export const saveLocationAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    const changed = await saveLocation(getDb(), a, str(fd, "projectId"), {
      address: str(fd, "address"), area: str(fd, "area"), latitude: str(fd, "latitude"), longitude: str(fd, "longitude"),
      sourceKind: str(fd, "sourceKind"), sourceReference: str(fd, "sourceReference"),
    });
    return changed.length ? d.loc.profile.saved : d.pm.noChange;
  });

export const verifyLocationAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    await verifyLocation(getDb(), a, str(fd, "projectId"));
    return d.loc.profile.verifiedMsg;
  });

export const createPlaceAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    await createPlace(getDb(), a, str(fd, "projectId"), placeInput(fd));
    return d.loc.places.created;
  });

export const updatePlaceAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => ((await updatePlace(getDb(), a, str(fd, "placeId"), placeInput(fd))).length ? d.loc.places.saved : d.pm.noChange));

export const verifyPlaceAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    await verifyPlace(getDb(), a, str(fd, "placeId"));
    return d.loc.places.verifiedMsg;
  });

export const archivePlaceAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    await archivePlace(getDb(), a, str(fd, "placeId"));
    return d.loc.places.archived;
  });

/** Reports which rows failed (line and field), or how many were imported. */
export async function importPlacesAction(_p: FormState, fd: FormData): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  const actor = await requireActor(locale, str(fd, "orgId"));
  try {
    const r = await importPlaces(getDb(), actor, str(fd, "projectId"), str(fd, "csv"), str(fd, "fileSource"));
    if (r.errors.length) {
      const errs = dict.loc.errors as Record<string, string>;
      const rows = r.errors.slice(0, 12).map((e) => format(dict.loc.import.row, { line: e.line, field: errs[e.field] ? errs[e.field]! : e.field })).join("; ");
      return { status: "error", message: format(dict.loc.import.failed, { rows }) };
    }
    revalidatePath(`/${locale}/o/${actor.orgId}`, "layout");
    return { status: "success", message: format(dict.loc.import.done, { n: r.imported }) };
  } catch (e) {
    return failed(e, dict.loc.errors);
  }
}
