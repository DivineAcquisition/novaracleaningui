-- Store the merchant representment that gets baked into the dispute packet.
-- This is the item-by-item finding (completed / missed / out of scope) plus
-- the remedy offered — not a cache of the generated PDF.

ALTER TABLE public.job_documentation
  ADD COLUMN IF NOT EXISTS representment jsonb;

COMMENT ON COLUMN public.job_documentation.representment IS
  'Merchant representment for the dispute packet: {headline, findings[{claim,ruling,evidence}], remedy, updated_at, updated_by}.';

-- NVC-0104 (Ben): persist the reviewed representment so the next Drive
-- remirror bakes it into the packet. Safe to re-run.
UPDATE public.job_documentation
SET representment = $rep${
  "headline": "Standard Clean was performed and documented. The customer received the published checklist at confirmation. On review, the only verified miss is kitchen and bathroom trash. A complimentary re-clean of those bins was offered the same day and declined in favor of a refund. A missed trash pull does not reverse the $155.10 visit.",
  "findings": [
    {
      "ruling": "completed",
      "claim": "Living room dusting, surfaces, window sills, furniture vacuum",
      "evidence": "Before vs after living-room shots: sofa staged, coffee table cleared, floors completed. Dusting is a reviewed finding against those frames."
    },
    {
      "ruling": "completed",
      "claim": "Bathroom mirrors",
      "evidence": "Powder-room after photo shows a clear mirror. Hall-bath vanity was cleared."
    },
    {
      "ruling": "completed",
      "claim": "Kitchen appliances, surfaces, stove top",
      "evidence": "Kitchen before vs after: island and floor cleared, bag removed, room reset. Stove is visible in the completed kitchen after shot."
    },
    {
      "ruling": "missed",
      "claim": "Kitchen and bathroom trash not removed / bags not replaced",
      "evidence": "Kitchen bin is in the same corner before and after. Hall-bath bin is visible in the before shot. This is the only verified checklist miss."
    }
  ],
  "remedy": "Complimentary targeted re-clean offered by SMS on 10 Sep 2026 at 21:53 UTC. Customer had already asked for a refund and did not accept the re-clean. Per Refund Policy §2.1 and §2.5, the re-clean is the primary remedy; declining it waives a refund of the completed visit.",
  "updated_at": "2026-09-11T20:00:00.000Z",
  "updated_by": "Ops"
}$rep$::jsonb,
    updated_at = now()
WHERE booking_id = '6a005147-2b96-4fc4-8d6d-2fce862251b7';

UPDATE public.bookings
SET issues_notes = $notes$Standard Clean performed and documented. Checklist sent at confirmation. Only verified miss: kitchen and bathroom trash. Re-clean offered 2026-09-10 21:53 UTC and declined. Refund Policy §2.1 / §2.5 — punch-list item is cured by re-clean, not a full reversal.$notes$
WHERE id = '6a005147-2b96-4fc4-8d6d-2fce862251b7'
  AND (issues_notes IS NULL OR issues_notes NOT LIKE '%Only verified miss: kitchen and bathroom trash%');
