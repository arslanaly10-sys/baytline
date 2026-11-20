"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  addRequestNote,
  createLease,
  createPmUnit,
  createProperty,
  createRequest,
  createWorkOrder,
  recordCompletion,
  recordVendorConfirmation,
  updateLease,
  updatePmUnit,
  updateProperty,
  updateRequest,
  updateTenantContact,
  updateWorkOrder,
} from "@baytline/management";
import type { FormState } from "@/lib/form-state";
import { getDb } from "../db";
import { localeAndDict, failed, requireActor, str } from "./helpers";

// Pattern for every action: actor from the session cookie, org ID only a claim, permission and
// org membership re-checked by @baytline/management, row-level security underneath.

type Ctx = Awaited<ReturnType<typeof begin>>;
async function begin(fd: FormData) {
  const { locale, dict } = await localeAndDict(fd);
  const actor = await requireActor(locale, str(fd, "orgId"));
  const base = `/${locale}/o/${actor.orgId}`;
  return { locale, dict, actor, base, refresh: () => revalidatePath(base, "layout") };
}

/** Saves and reports; `changed` is the list of fields the service says it updated. */
async function run(fd: FormData, fn: (c: Ctx) => Promise<string>): Promise<FormState> {
  const c = await begin(fd);
  try {
    const message = await fn(c);
    c.refresh();
    return { status: "success", message };
  } catch (e) {
    return failed(e, c.dict.pm.errors);
  }
}

/** Creates, then opens the new record. */
async function create(fd: FormData, fn: (c: Ctx) => Promise<string>): Promise<FormState> {
  const c = await begin(fd);
  let target: string;
  try {
    target = await fn(c);
    c.refresh();
  } catch (e) {
    return failed(e, c.dict.pm.errors);
  }
  redirect(target);
}

const saved = (changed: string[], c: Ctx, ok: string) => (changed.length ? ok : c.dict.pm.noChange);

// ---------------------------------------------------------------- properties and units

const propertyInput = (fd: FormData) => ({
  name: str(fd, "name"),
  market: str(fd, "market"),
  city: str(fd, "city"),
  address: str(fd, "address"),
  propertyType: str(fd, "propertyType"),
  ownerName: str(fd, "ownerName"),
  managementBasis: str(fd, "managementBasis"),
  agreementRef: str(fd, "agreementRef"),
  agreementStart: str(fd, "agreementStart"),
  agreementEnd: str(fd, "agreementEnd"),
  notes: str(fd, "notes"),
  status: str(fd, "status"),
});

export async function createPropertyAction(_p: FormState, fd: FormData): Promise<FormState> {
  return create(fd, async (c) => `${c.base}/portfolio/${await createProperty(getDb(), c.actor, propertyInput(fd))}`);
}

export async function updatePropertyAction(_p: FormState, fd: FormData): Promise<FormState> {
  return run(fd, async (c) => saved(await updateProperty(getDb(), c.actor, str(fd, "propertyId"), propertyInput(fd)), c, c.dict.pm.properties.saved));
}

const unitInput = (fd: FormData) => ({
  code: str(fd, "code"),
  unitType: str(fd, "unitType"),
  bedrooms: str(fd, "bedrooms"),
  areaSqm: str(fd, "areaSqm"),
  floor: str(fd, "floor"),
  occupancy: str(fd, "occupancy"),
  notes: str(fd, "notes"),
});

export async function createPmUnitAction(_p: FormState, fd: FormData): Promise<FormState> {
  return create(fd, async (c) => `${c.base}/portfolio/units/${await createPmUnit(getDb(), c.actor, str(fd, "propertyId"), unitInput(fd))}`);
}

export async function updatePmUnitAction(_p: FormState, fd: FormData): Promise<FormState> {
  return run(fd, async (c) => {
    const changed = await updatePmUnit(getDb(), c.actor, str(fd, "unitId"), unitInput(fd));
    return saved(changed, c, changed.length === 1 && changed[0] === "occupancy" ? c.dict.pm.units.occupancySaved : c.dict.pm.units.saved);
  });
}

// ---------------------------------------------------------------- leases

const leaseInput = (fd: FormData) => ({
  reference: str(fd, "reference"),
  status: str(fd, "status"),
  startDate: str(fd, "startDate"),
  endDate: str(fd, "endDate"),
  renewalDate: str(fd, "renewalDate"),
  rent: str(fd, "rent"),
  currency: str(fd, "currency"),
  paymentFrequency: str(fd, "paymentFrequency"),
  paymentTerms: str(fd, "paymentTerms"),
  deposit: str(fd, "deposit"),
  notes: str(fd, "notes"),
});

export async function createLeaseAction(_p: FormState, fd: FormData): Promise<FormState> {
  return create(fd, async (c) => {
    const tenantId = str(fd, "tenantId");
    const id = await createLease(getDb(), c.actor, {
      ...leaseInput(fd),
      unitId: str(fd, "unitId"),
      tenantId: tenantId || undefined,
      newTenant: tenantId ? undefined : { name: str(fd, "tenantName"), email: str(fd, "tenantEmail"), phone: str(fd, "tenantPhone") },
    });
    return `${c.base}/leasing/${id}`;
  });
}

export async function updateLeaseAction(_p: FormState, fd: FormData): Promise<FormState> {
  return run(fd, async (c) => saved(await updateLease(getDb(), c.actor, str(fd, "leaseId"), leaseInput(fd)), c, c.dict.pm.leases.saved));
}

export async function updateTenantContactAction(_p: FormState, fd: FormData): Promise<FormState> {
  return run(fd, async (c) => {
    await updateTenantContact(getDb(), c.actor, str(fd, "tenantId"), { email: str(fd, "email"), phone: str(fd, "phone") });
    return c.dict.pm.leases.contactSaved;
  });
}

// ---------------------------------------------------------------- requests

export async function createRequestAction(_p: FormState, fd: FormData): Promise<FormState> {
  return create(fd, async (c) => {
    const id = await createRequest(getDb(), c.actor, {
      propertyId: str(fd, "propertyId"),
      unitId: str(fd, "unitId"),
      tenantId: str(fd, "tenantId"),
      title: str(fd, "title"),
      description: str(fd, "description"),
      category: str(fd, "category"),
      priority: str(fd, "priority"),
      assigneeId: str(fd, "assigneeId"),
    });
    return `${c.base}/requests/${id}`;
  });
}

export async function updateRequestAction(_p: FormState, fd: FormData): Promise<FormState> {
  return run(fd, async (c) =>
    saved(
      await updateRequest(getDb(), c.actor, str(fd, "requestId"), {
        title: str(fd, "title"),
        description: str(fd, "description"),
        category: str(fd, "category"),
        priority: str(fd, "priority"),
        status: str(fd, "status"),
        assigneeId: str(fd, "assigneeId"),
      }),
      c,
      c.dict.pm.requests.saved,
    ),
  );
}

export async function addRequestNoteAction(_p: FormState, fd: FormData): Promise<FormState> {
  return run(fd, async (c) => {
    await addRequestNote(getDb(), c.actor, str(fd, "requestId"), str(fd, "body"));
    return c.dict.pm.requests.noteAdded;
  });
}

// ---------------------------------------------------------------- maintenance

const workInput = (fd: FormData) => ({
  propertyId: str(fd, "propertyId"),
  unitId: str(fd, "unitId"),
  requestId: str(fd, "requestId"),
  title: str(fd, "title"),
  description: str(fd, "description"),
  status: str(fd, "status"),
  assigneeId: str(fd, "assigneeId"),
  vendorName: str(fd, "vendorName"),
  scheduledFor: str(fd, "scheduledFor"),
});

export async function createWorkOrderAction(_p: FormState, fd: FormData): Promise<FormState> {
  return create(fd, async (c) => `${c.base}/maintenance/${await createWorkOrder(getDb(), c.actor, workInput(fd))}`);
}

export async function updateWorkOrderAction(_p: FormState, fd: FormData): Promise<FormState> {
  return run(fd, async (c) => saved(await updateWorkOrder(getDb(), c.actor, str(fd, "workOrderId"), workInput(fd)), c, c.dict.pm.work.saved));
}

export async function recordVendorConfirmationAction(_p: FormState, fd: FormData): Promise<FormState> {
  return run(fd, async (c) => {
    await recordVendorConfirmation(getDb(), c.actor, str(fd, "workOrderId"));
    return c.dict.pm.work.vendorRecorded;
  });
}

export async function recordCompletionAction(_p: FormState, fd: FormData): Promise<FormState> {
  return run(fd, async (c) => {
    await recordCompletion(getDb(), c.actor, str(fd, "workOrderId"), { notes: str(fd, "notes"), cost: str(fd, "cost") });
    return c.dict.pm.work.completed;
  });
}
