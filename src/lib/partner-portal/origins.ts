export const PARTNERS_ORIGIN =
  process.env.NEXT_PUBLIC_PARTNERS_ORIGIN ||
  process.env.PARTNERS_ORIGIN ||
  "https://partners.novaracleaning.com";

export const PARTNER_ORIGIN =
  process.env.NEXT_PUBLIC_PARTNER_ORIGIN ||
  process.env.PARTNER_ORIGIN ||
  "https://partner.novaracleaning.com";

export function partnersOrigin(): string {
  return PARTNERS_ORIGIN.replace(/\/+$/, "");
}

export function portalHomeUrl(): string {
  return `${partnersOrigin()}/partner`;
}

export function enterUrl(token: string): string {
  return `${partnersOrigin()}/partner/enter/${token}`;
}

export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h.includes("localhost") || h.includes("127.0.0.1");
}
