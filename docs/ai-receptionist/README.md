# AI receptionist knowledge

The dialer and the inbound receptionist pull one document:

`GET /api/receptionist/knowledge`

The source is `src/lib/receptionist-knowledge.ts`. Change that file, then deploy, and the next pull picks it up.

The pack includes the service menus, the price tables the booking screen charges, the FAQs, the cancellation rules, and the sales-call script. Recorded call transcripts were not available, so the script is the booking-desk script, with the lines the agent must not say written out.

The same document is a PDF:

- `docs/ai-receptionist/NovaraCleaning_Receptionist_Knowledge.pdf`
- `https://app.novaracleaning.com/receptionist/NovaraCleaning_Receptionist_Knowledge.pdf` after deploy

Rebuild it with `npm run receptionist:pdf` after the knowledge file changes.

Do not paste cleaner pay, the internal price floor, or an unapproved discount into this file.
