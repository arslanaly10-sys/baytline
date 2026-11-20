/** What a server action returns to <ActionForm>. Messages are already translated on the server. */
export type FormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string; link?: string; note?: string };

export const IDLE: FormState = { status: "idle" };
