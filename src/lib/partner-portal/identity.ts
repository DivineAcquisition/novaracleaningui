import { normalizeEmail, looksLikeEmail } from "./tokens";

type Admin = any;

export interface PartnerHostLink {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  paymentOption: string | null;
  cardOnFile: boolean;
  payAfterEnabled: boolean;
}

export interface PartnerAccountLink {
  id: string;
  businessName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  accountType: string;
  billingMethod: "auto_pay" | "invoiced" | null;
}

export interface PartnerPropertyManagerLink {
  id: string;
  companyName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  billingMethod: "auto_pay" | "invoiced" | null;
  invoiceCycle: string | null;
  netTerms: string | null;
  volumeDiscountPercent: number;
  volumeDiscountLabel: string | null;
}

export type PartnerKind = "host" | "commercial" | "property_manager";

export interface PartnerIdentity {
  id: string;
  email: string;
  displayName: string | null;
  phone: string | null;
  hosts: PartnerHostLink[];
  accounts: PartnerAccountLink[];
  propertyManagers: PartnerPropertyManagerLink[];
  kinds: PartnerKind[];
}

export function kindsOf(
  identity: Pick<PartnerIdentity, "hosts" | "accounts"> & {
    propertyManagers?: PartnerPropertyManagerLink[];
  },
): PartnerKind[] {
  const kinds: PartnerKind[] = [];
  if (identity.hosts.length) kinds.push("host");
  if (identity.accounts.length) kinds.push("commercial");
  if (identity.propertyManagers?.length) kinds.push("property_manager");
  return kinds;
}

const PM_COLS =
  "id, company_name, contact_name, email, phone, status, billing_method, invoice_cycle, net_terms, volume_discount_percent, volume_discount_label";

function pmLink(row: Record<string, any>): PartnerPropertyManagerLink {
  const method = row.billing_method || null;
  return {
    id: row.id,
    companyName: row.company_name,
    contactName: row.contact_name || null,
    email: row.email || null,
    phone: row.phone || null,
    status: row.status,
    billingMethod: method === "invoiced" ? "invoiced" : method === "auto_pay" ? "auto_pay" : null,
    invoiceCycle: row.invoice_cycle || null,
    netTerms: row.net_terms || null,
    volumeDiscountPercent: Number(row.volume_discount_percent || 0),
    volumeDiscountLabel: row.volume_discount_label || null,
  };
}

async function loadLinked(
  supabase: Admin,
  identityId: string,
  email: string,
): Promise<{
  hosts: PartnerHostLink[];
  accounts: PartnerAccountLink[];
  propertyManagers: PartnerPropertyManagerLink[];
}> {
  const [{ data: hostLinks }, { data: accountLinks }, { data: pmLinks }] = await Promise.all([
    supabase.from("partner_identity_hosts").select("host_id").eq("identity_id", identityId),
    supabase.from("partner_identity_accounts").select("business_account_id").eq("identity_id", identityId),
    supabase.from("partner_identity_property_managers").select("pm_account_id").eq("identity_id", identityId),
  ]);

  const hostIds = (hostLinks || []).map((r: { host_id: string }) => r.host_id);
  const accountIds = (accountLinks || []).map((r: { business_account_id: string }) => r.business_account_id);
  const pmIds = (pmLinks || []).map((r: { pm_account_id: string }) => r.pm_account_id);

  const hosts: PartnerHostLink[] = [];
  if (hostIds.length) {
    const { data } = await supabase
      .from("hosts")
      .select("id, name, email, phone, status, preferred_payment_option, default_payment_method_id, pay_after_enabled")
      .in("id", hostIds);
    for (const h of data || []) {
      hosts.push({
        id: h.id,
        name: h.name || null,
        email: h.email || null,
        phone: h.phone || null,
        status: h.status,
        paymentOption: h.preferred_payment_option || null,
        cardOnFile: !!h.default_payment_method_id,
        payAfterEnabled: !!h.pay_after_enabled,
      });
    }
  }

  const accounts: PartnerAccountLink[] = [];
  if (accountIds.length) {
    const { data } = await supabase
      .from("business_accounts")
      .select("id, business_name, contact_name, email, phone, status, account_type, preferred_billing_method, billing_method")
      .in("id", accountIds)
      .neq("status", "offboarded");
    for (const a of data || []) {
      const method = a.preferred_billing_method || a.billing_method || null;
      accounts.push({
        id: a.id,
        businessName: a.business_name,
        contactName: a.contact_name || null,
        email: a.email || null,
        phone: a.phone || null,
        status: a.status,
        accountType: a.account_type,
        billingMethod: method === "invoiced" ? "invoiced" : method === "auto_pay" ? "auto_pay" : null,
      });
    }
  }

  const propertyManagers: PartnerPropertyManagerLink[] = [];
  if (pmIds.length) {
    const { data } = await supabase
      .from("property_manager_accounts")
      .select(PM_COLS)
      .in("id", pmIds)
      .neq("status", "offboarded");
    for (const p of data || []) propertyManagers.push(pmLink(p));
  }

  // Email fallback for records that predate the identity link tables.
  if (!hosts.length) {
    const { data } = await supabase
      .from("hosts")
      .select("id, name, email, phone, status, preferred_payment_option, default_payment_method_id, pay_after_enabled")
      .ilike("email", email)
      .limit(5);
    for (const h of data || []) {
      hosts.push({
        id: h.id,
        name: h.name || null,
        email: h.email || null,
        phone: h.phone || null,
        status: h.status,
        paymentOption: h.preferred_payment_option || null,
        cardOnFile: !!h.default_payment_method_id,
        payAfterEnabled: !!h.pay_after_enabled,
      });
      await supabase
        .from("partner_identity_hosts")
        .upsert({ identity_id: identityId, host_id: h.id }, { onConflict: "host_id" });
    }
  }

  if (!accounts.length) {
    const { data } = await supabase
      .from("business_accounts")
      .select("id, business_name, contact_name, email, phone, status, account_type, preferred_billing_method, billing_method")
      .ilike("email", email)
      .neq("status", "offboarded")
      .limit(5);
    for (const a of data || []) {
      const method = a.preferred_billing_method || a.billing_method || null;
      accounts.push({
        id: a.id,
        businessName: a.business_name,
        contactName: a.contact_name || null,
        email: a.email || null,
        phone: a.phone || null,
        status: a.status,
        accountType: a.account_type,
        billingMethod: method === "invoiced" ? "invoiced" : method === "auto_pay" ? "auto_pay" : null,
      });
      await supabase
        .from("partner_identity_accounts")
        .upsert({ identity_id: identityId, business_account_id: a.id }, { onConflict: "business_account_id" });
    }
  }

  if (!propertyManagers.length) {
    const { data } = await supabase
      .from("property_manager_accounts")
      .select(PM_COLS)
      .ilike("email", email)
      .neq("status", "offboarded")
      .limit(5);
    for (const p of data || []) {
      propertyManagers.push(pmLink(p));
      await supabase
        .from("partner_identity_property_managers")
        .upsert({ identity_id: identityId, pm_account_id: p.id }, { onConflict: "pm_account_id" });
    }
  }

  return { hosts, accounts, propertyManagers };
}

export async function getIdentity(supabase: Admin, identityId: string): Promise<PartnerIdentity | null> {
  const { data } = await supabase.from("partner_identities").select("*").eq("id", identityId).maybeSingle();
  if (!data) return null;
  const linked = await loadLinked(supabase, data.id, String(data.email));
  return {
    id: data.id,
    email: String(data.email),
    displayName: data.display_name || null,
    phone: data.phone || null,
    hosts: linked.hosts,
    accounts: linked.accounts,
    propertyManagers: linked.propertyManagers,
    kinds: kindsOf(linked),
  };
}

export async function findIdentityByEmail(supabase: Admin, email: string): Promise<PartnerIdentity | null> {
  const e = normalizeEmail(email);
  if (!looksLikeEmail(e)) return null;
  const { data } = await supabase.from("partner_identities").select("*").ilike("email", e).maybeSingle();
  if (!data) return null;
  return getIdentity(supabase, data.id);
}

/** Find or create the one identity for this email and link any matching relationships. */
export async function ensureIdentity(
  supabase: Admin,
  input: {
    email: string;
    displayName?: string | null;
    phone?: string | null;
    hostId?: string | null;
    accountId?: string | null;
    pmAccountId?: string | null;
  },
): Promise<PartnerIdentity | null> {
  const email = normalizeEmail(input.email);
  if (!looksLikeEmail(email)) return null;

  let { data: row } = await supabase.from("partner_identities").select("*").ilike("email", email).maybeSingle();
  if (!row) {
    const inserted = await supabase
      .from("partner_identities")
      .insert({
        email,
        display_name: input.displayName || null,
        phone: input.phone || null,
      })
      .select("*")
      .single();
    if (inserted.error || !inserted.data) {
      const again = await supabase.from("partner_identities").select("*").ilike("email", email).maybeSingle();
      row = again.data;
    } else {
      row = inserted.data;
    }
  }
  if (!row) return null;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.displayName && !row.display_name) patch.display_name = input.displayName;
  if (input.phone && !row.phone) patch.phone = input.phone;
  if (Object.keys(patch).length > 1) {
    await supabase.from("partner_identities").update(patch).eq("id", row.id);
  }

  if (input.hostId) {
    await supabase
      .from("partner_identity_hosts")
      .upsert({ identity_id: row.id, host_id: input.hostId }, { onConflict: "host_id" });
  }
  if (input.accountId) {
    await supabase
      .from("partner_identity_accounts")
      .upsert({ identity_id: row.id, business_account_id: input.accountId }, { onConflict: "business_account_id" });
  }
  if (input.pmAccountId) {
    await supabase
      .from("partner_identity_property_managers")
      .upsert({ identity_id: row.id, pm_account_id: input.pmAccountId }, { onConflict: "pm_account_id" });
  }

  return getIdentity(supabase, row.id);
}

/** True when this email already has any partner relationship (or an identity). */
export async function emailHasPartnership(supabase: Admin, email: string): Promise<boolean> {
  const e = normalizeEmail(email);
  if (!looksLikeEmail(e)) return false;
  const identity = await findIdentityByEmail(supabase, e);
  if (identity && identity.kinds.length) return true;
  const [{ data: host }, { data: account }, { data: pm }] = await Promise.all([
    supabase.from("hosts").select("id").ilike("email", e).limit(1).maybeSingle(),
    supabase.from("business_accounts").select("id").ilike("email", e).neq("status", "offboarded").limit(1).maybeSingle(),
    supabase
      .from("property_manager_accounts")
      .select("id")
      .ilike("email", e)
      .neq("status", "offboarded")
      .limit(1)
      .maybeSingle(),
  ]);
  return !!(host?.id || account?.id || pm?.id);
}
