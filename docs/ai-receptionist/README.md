# AI receptionist knowledge

The dialer and the inbound receptionist pull one document:

`GET /api/receptionist/knowledge`

The source is `src/lib/receptionist-knowledge.ts`. Change that file, then deploy, and the next pull picks it up.

The pack includes the service menus, the price tables the booking screen charges, the FAQs, the cancellation rules, and the sales-call script. Recorded call transcripts were not available, so the script is the booking-desk script, with the lines the agent must not say written out.

The same document is a PDF:

- `docs/ai-receptionist/NovaraCleaning_Receptionist_Knowledge.pdf`
- `https://app.novaracleaning.com/receptionist/NovaraCleaning_Receptionist_Knowledge.pdf` after deploy

The sales call is its own PDF. It is the one to give the dialer:

- `docs/ai-receptionist/NovaraCleaning_Sales_Call.pdf`
- `https://app.novaracleaning.com/receptionist/NovaraCleaning_Sales_Call.pdf` after deploy

A hesitant buyer whose service is over $175 can be offered $10 off, then $15 off. The price has to be saved before it is texted or emailed. The sales PDF also says which details to capture and how the customer pays the deposit and finishes the details page.

Upload this set into the receptionist knowledge base. One file is one topic:

- `docs/ai-receptionist/knowledge-base/00-index.pdf`
- `docs/ai-receptionist/knowledge-base/01-identity.pdf`
- `docs/ai-receptionist/knowledge-base/02-menus.pdf`
- `docs/ai-receptionist/knowledge-base/03-prices.pdf`
- `docs/ai-receptionist/knowledge-base/04-policies.pdf`
- `docs/ai-receptionist/knowledge-base/05-faqs.pdf`
- `docs/ai-receptionist/knowledge-base/06-sales-call.pdf`
- `docs/ai-receptionist/knowledge-base/07-booking-flow.pdf`
- `docs/ai-receptionist/knowledge-base/08-live-functions.pdf`

The same files are under `public/receptionist/knowledge-base/` so they can be fetched after deploy.

Rebuild both with `npm run receptionist:pdf` after the knowledge file changes.

Do not paste cleaner pay, the internal price floor, or an unapproved discount into this file.
