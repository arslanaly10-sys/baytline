/** Prints docs/permission-matrix.md from ROLE_GRANTS. Run: pnpm --filter @baytline/core matrix */
import { PERMISSIONS, ROLE_GRANTS, approverPermission, type Permission } from "../src/permissions.ts";
import { ROLES, type Role } from "../src/roles.ts";

const roles = Object.keys(ROLES) as Role[];
const abbrev: Record<string, string> = { platform: "P", org: "O", shared: "S", assigned: "A", self: "U", public: "Pub" };
const lines = [
  "# Permission matrix",
  "",
  "_Generated from `packages/core/src/permissions.ts` by `pnpm --filter @baytline/core matrix`. Do not edit by hand._",
  "",
  "Scopes: **P** platform-wide, **O** own organization, **S** own org + records explicitly shared with it, **A** assigned to the user, **U** the user themself, **Pub** published listings.",
  "Effect: R read, W write, **C** consequential (human-only; † = needs a second person's approval).",
  "",
  `| Permission | Effect | ${roles.join(" | ")} |`,
  `|---|---|${roles.map(() => "---").join("|")}|`,
];
for (const p of Object.keys(PERMISSIONS) as Permission[]) {
  const e = PERMISSIONS[p].effect;
  const eff = e === "read" ? "R" : e === "write" ? "W" : approverPermission(p) ? "**C**†" : "**C**";
  const cells = roles.map((r) => ROLE_GRANTS[r].filter(([x]) => x === p).map(([, s]) => abbrev[s]).join(",") || "");
  lines.push(`| \`${p}\` | ${eff} | ${cells.join(" | ")} |`);
}
console.log(lines.join("\n"));
