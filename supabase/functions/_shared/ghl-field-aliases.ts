// Maps internal custom-field keys to every GHL fieldKey / label we have seen
// in production (contact.* prefix, numeric prefixes, human labels).

export const GHL_FIELD_KEY_ALIASES: Record<string, string[]> = {
  assigned_cleaner_pay_tier: [
    "assigned_cleaner_pay_tier",
    "Assigned Cleaner Pay Tier",
    "contact.assigned_cleaner_pay_tier",
  ],
  "1_contractor": ["1_contractor", "contractor_1", "Contractor 1", "contact.1_contractor"],
  "2_contractor": ["2_contractor", "contractor_2", "Contractor 2", "contact.2_contractor"],
  "3_contractor": ["3_contractor", "contractor_3", "Contractor 3", "contact.3_contractor"],
  "1_contractor_number": [
    "1_contractor_number",
    "contractor_1_number",
    "Contractor 1 Number",
    "contact.1_contractor_number",
  ],
  "2_contractor_number": [
    "2_contractor_number",
    "contractor_2_number",
    "Contractor 2 Number",
    "contact.2_contractor_number",
  ],
  "3_contractor_number": [
    "3_contractor_number",
    "contractor_3_number",
    "Contractor 3 Number",
    "contact.3_contractor_number",
  ],
  "1_contractor_pay": [
    "1_contractor_pay",
    "contractor_1_pay",
    "Contractor 1 Pay",
    "contact.1_contractor_pay",
    "contact.contractor_1_pay",
  ],
  "2_contractor_pay": [
    "2_contractor_pay",
    "contractor_2_pay",
    "Contractor 2 Pay",
    "contact.2_contractor_pay",
    "contact.contractor_2_pay",
  ],
  "3_contractor_pay": [
    "3_contractor_pay",
    "contractor_3_pay",
    "Contractor 3 Pay",
    "contact.3_contractor_pay",
    "contact.contractor_3_pay",
  ],
  "1_contractor_pay_percentage": [
    "1_contractor_pay_percentage",
    "contractor_1_pay_percentage",
    "Contractor 1 Pay Percentage",
    "contact.1_contractor_pay_percentage",
  ],
  "2_contractor_pay_percentage": [
    "2_contractor_pay_percentage",
    "contractor_2_pay_percentage",
    "Contractor 2 Pay Percentage",
    "contact.2_contractor_pay_percentage",
  ],
  "3_contractor_pay_percentage": [
    "3_contractor_pay_percentage",
    "contractor_3_pay_percentage",
    "Contractor 3 Pay Percentage",
    "contact.3_contractor_pay_percentage",
  ],
  team_size_assigned: ["team_size_assigned", "Team Size Assigned", "contact.team_size_assigned"],
  estimated_duration_hrs: [
    "estimated_duration_hrs",
    "Estimated Duration Hrs",
    "contact.estimated_duration_hrs",
  ],
};

/** Resolve a GHL custom-field UUID from our canonical key. */
export function resolveGhlFieldId(
  fieldMap: Record<string, string>,
  canonicalKey: string,
): string | undefined {
  const candidates = GHL_FIELD_KEY_ALIASES[canonicalKey] ?? [canonicalKey];
  for (const c of candidates) {
    const bare = c.split(".").pop() || c;
    const id = fieldMap[c] ?? fieldMap[bare] ?? fieldMap[`contact.${bare}`];
    if (id) return id;
  }
  return undefined;
}

/**
 * Duplicate canonical ops/pay values onto every alias key that exists in GHL
 * so updates land regardless of how the field was created in the CRM.
 */
export function expandGhlCustomFieldKeys(
  fieldMap: Record<string, string>,
  byKey: Record<string, string | number | boolean | null | undefined>,
): Record<string, string | number | boolean | null | undefined> {
  const out = { ...byKey };
  for (const [canonical, value] of Object.entries(byKey)) {
    const aliases = GHL_FIELD_KEY_ALIASES[canonical];
    if (!aliases || !resolveGhlFieldId(fieldMap, canonical)) continue;
    for (const alias of aliases) {
      if (alias !== canonical) out[alias] = value;
    }
  }
  return out;
}
