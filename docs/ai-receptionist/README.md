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

Rebuild both with `npm run receptionist:pdf` after the knowledge file changes.

Do not paste cleaner pay, the internal price floor, or an unapproved discount into this file.
