// ─── Job A: add the 6 cross-table link fields (one-time, idempotent) ──────────
//
// The base already has every data field; what's missing are the record links
// between tables. This script creates them via the Airtable Meta API. It checks
// whether each link field already exists (by name on its table) before creating
// it, so re-running is always safe — no duplicates.
//
//   Run:  npm run airtable:links
//   (requires AIRTABLE_PAT with the schema.bases:write scope)
//
// Airtable auto-creates the symmetric reverse field on each linked table.

import { loadEnv } from "./_env";
import {
  createLinkField,
  LINK_FIELDS,
  listTableFields,
  ping,
} from "../src/lib/airtable/index";

async function main(): Promise<void> {
  loadEnv();

  const conn = await ping();
  if (!conn.ok) {
    console.error(`✗ Cannot reach Airtable: ${conn.message}`);
    process.exit(1);
  }
  console.log(`✓ ${conn.message}`);

  // Cache existing field names per table so we only fetch each table's schema once.
  const existingByTable = new Map<string, Set<string>>();
  async function existingNames(tableId: string): Promise<Set<string>> {
    if (!existingByTable.has(tableId)) {
      const fields = await listTableFields(tableId);
      existingByTable.set(tableId, new Set(fields.map((f) => f.name)));
    }
    return existingByTable.get(tableId)!;
  }

  let created = 0;
  let skipped = 0;

  for (const spec of LINK_FIELDS) {
    const names = await existingNames(spec.tableId);
    if (names.has(spec.name)) {
      console.log(`• skip (exists): ${spec.description} — "${spec.name}"`);
      skipped++;
      continue;
    }
    try {
      const field = await createLinkField(spec.tableId, spec.name, spec.linkedTableId);
      names.add(field.name); // keep cache fresh if another spec targets the same table
      console.log(`+ created: ${spec.description} — "${field.name}" (${field.id})`);
      created++;
    } catch (err) {
      console.error(`✗ failed to create "${spec.name}" on ${spec.tableId}: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  }

  console.log(`\nDone. created=${created} skipped=${skipped} total=${LINK_FIELDS.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
