// ─── Commercial portal provisioning ────────────────────────────────────────
//
// Creating the client's login for partner.novaracleaning.com, from inside the
// onboarding session, so they finish with working access rather than a signed
// PDF and a promise that someone will set them up.
//
// This follows the same shape as provisionHostAccount() for STR hosts:
// createUser with the email pre-confirmed, then link the account. The one
// difference is the link itself. A host is joined to its record by
// hosts.user_id; a commercial account had no such column, and the portal
// matched an auth user to an account by EMAIL EQUALITY alone. That cannot be
// provisioned reliably — the person signing is very often not the address on
// the account (an office manager signs, accounts payable is the account
// email) — so business_accounts.portal_user_id now carries the link
// explicitly, with email matching kept as a fallback for accounts that
// predate it.

import { partnersOrigin } from "@/lib/partner-portal/origins";

// eslint-disable-next-line
type Admin = any;

export interface ProvisionPortalInput {
  accountId: string;
  email: string;
  password?: string;
  fullName?: string;
  businessName?: string;
}

export interface ProvisionPortalResult {
  ok: boolean;
  created: boolean;
  /** True when the email already had an account — we link rather than fail. */
  linkedExisting: boolean;
  userId: string | null;
  error?: string;
  handoffUrl?: string;
}

const MIN_PASSWORD_LENGTH = 8;

function isDuplicate(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("already been registered") || m.includes("already registered") || m.includes("duplicate");
}

async function findUserIdByEmail(admin: Admin, email: string): Promise<string | null> {
  // listUsers is paginated and has no email filter in this SDK version, so
  // scan the first pages rather than pulling the whole table.
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    const hit = data.users.find(
      (u: { email?: string | null; id: string }) =>
        String(u.email || "").toLowerCase() === email.toLowerCase(),
    );
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

export function validatePortalPassword(password: string, minLength = MIN_PASSWORD_LENGTH): string | null {
  if (!password || password.length < minLength) {
    return `Choose a password of at least ${minLength} characters.`;
  }
  return null;
}

const PARTNER_ORIGIN = partnersOrigin();

/**
 * Staff-side: create (or link) the portal login before a proposal can go out.
 * Sends Supabase's invite email when the address is new; links an existing
 * login when it is not. Does not set a password — they choose one from the invite.
 */
export async function inviteCommercialPortalUser(
  admin: Admin,
  input: Omit<ProvisionPortalInput, "password">,
): Promise<ProvisionPortalResult & { invited: boolean }> {
  const result: ProvisionPortalResult & { invited: boolean } = {
    ok: false,
    created: false,
    linkedExisting: false,
    invited: false,
    userId: null,
  };

  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    result.error = "That doesn't look like a valid email address.";
    return result;
  }

  try {
    const invited = await admin.auth.admin.inviteUserByEmail(email, {
      data: {
        is_commercial_client: true,
        business_account_id: input.accountId,
        business_name: input.businessName || null,
        full_name: input.fullName || null,
      },
      redirectTo: `${PARTNER_ORIGIN}/auth/callback`,
    });

    if (invited.error) {
      if (!isDuplicate(invited.error.message)) {
        result.error = invited.error.message;
        return result;
      }
      result.linkedExisting = true;
      result.userId = await findUserIdByEmail(admin, email);
      if (!result.userId) {
        result.error =
        "That email already has an account, but we couldn't link it. Ask them to sign in at partner.novaracleaning.com.";
        return result;
      }
    } else {
      result.created = true;
      result.invited = true;
      result.userId = invited.data?.user?.id || null;
    }

    if (!result.userId) {
      result.error = "The login was created but could not be linked.";
      return result;
    }

    const { error: linkError } = await admin
      .from("business_accounts")
      .update({
        portal_user_id: result.userId,
        portal_created_at: new Date().toISOString(),
      })
      .eq("id", input.accountId);
    if (linkError) {
      result.error = linkError.message;
      return result;
    }

    result.ok = true;
    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }
}

/**
 * Create (or link) the portal login and attach it to the account.
 *
 * Never throws: a failure here must not undo a signature or a configured
 * billing profile, both of which have already happened by this point. The
 * caller reports the error and the client can try again or be provisioned by
 * an admin later.
 */
export async function provisionCommercialPortalUser(
  admin: Admin,
  input: ProvisionPortalInput,
): Promise<ProvisionPortalResult> {
  const result: ProvisionPortalResult = {
    ok: false,
    created: false,
    linkedExisting: false,
    userId: null,
  };

  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    result.error = "That doesn't look like a valid email address.";
    return result;
  }

  try {
    const { provisionCommercialPortalAccess } = await import("@/lib/partner-portal/handoff");
    const access = await provisionCommercialPortalAccess({
      email,
      accountId: input.accountId,
      displayName: input.fullName || null,
    });
    if (!access.ok) {
      result.error = access.error || "Could not open portal access.";
      return result;
    }
    result.handoffUrl = access.handoffUrl;

    const created = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        is_commercial_client: true,
        business_account_id: input.accountId,
        business_name: input.businessName || null,
        full_name: input.fullName || null,
      },
    });

    if (created.error) {
      if (isDuplicate(created.error.message)) {
        result.linkedExisting = true;
        result.userId = await findUserIdByEmail(admin, email);
      }
    } else {
      result.created = true;
      result.userId = created.data?.user?.id || null;
    }

    await admin
      .from("business_accounts")
      .update({
        ...(result.userId ? { portal_user_id: result.userId } : {}),
        portal_created_at: new Date().toISOString(),
      })
      .eq("id", input.accountId);

    result.ok = true;
    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }
}
