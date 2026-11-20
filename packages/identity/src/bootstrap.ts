import pg from "pg";
import { isMarketCode } from "@baytline/core";
import { newToken, sha256 } from "./crypto";
import { INVITATION_DAYS } from "./members";
import { normalizeEmail } from "./validation";

/**
 * Operator bootstrap: ensures the platform organization exists and creates a
 * one-time invitation for a platform administrator. Runs with the OWNER role,
 * from a terminal only. No passwords are created or printed; the operator
 * follows the link and chooses their own.
 */
export async function createBootstrapInvitation(
  ownerUrl: string,
  input: { email: string; market?: string; orgName?: string },
): Promise<{ token: string; orgId: string }> {
  const email = normalizeEmail(input.email);
  const market = input.market ?? "AE";
  if (!isMarketCode(market)) throw new Error(`Unknown market ${market}`);
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query("begin");
    let { rows } = await client.query<{ id: string }>("select id from app.organizations where type = 'platform'");
    if (!rows[0]) {
      ({ rows } = await client.query<{ id: string }>(
        "insert into app.organizations (type, name, market) values ('platform', $1, $2) returning id",
        [input.orgName ?? "Platform operations", market],
      ));
    }
    const orgId = rows[0]!.id;
    const member = await client.query(
      "select 1 from app.memberships m join app.users u on u.id = m.user_id where m.org_id = $1 and u.email = $2 and m.status = 'active'",
      [orgId, email],
    );
    if (member.rowCount) throw new Error(`${email} is already an active member of the platform organization`);
    await client.query("update app.invitations set status = 'revoked', revoked_at = now() where org_id = $1 and email = $2 and status = 'pending'", [orgId, email]);
    const token = newToken();
    const inv = await client.query<{ id: string }>(
      `insert into app.invitations (org_id, email, role, token_hash, invited_by, expires_at)
       values ($1, $2, 'platform_admin', $3, null, now() + make_interval(days => $4)) returning id`,
      [orgId, email, sha256(token), INVITATION_DAYS],
    );
    await client.query(
      `insert into app.audit_events (actor_kind, org_id, event_type, outcome, target_type, target_id, metadata)
       values ('system', $1, 'invitation.created', 'success', 'invitation', $2, '{"role":"platform_admin","via":"operator_bootstrap"}')`,
      [orgId, inv.rows[0]!.id],
    );
    await client.query("commit");
    return { token, orgId };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}
