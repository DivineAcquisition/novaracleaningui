const FLASH = ["wrong_domain", "no_role", "signed_out"] as const;
export type DocsAuthFlash = (typeof FLASH)[number];

/** Query-param flash after an OAuth bounce that signed the user out. */
export function docsFlash(value: string | string[] | undefined): DocsAuthFlash | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "wrong_domain" || raw === "no_role" || raw === "signed_out") return raw;
  return null;
}
