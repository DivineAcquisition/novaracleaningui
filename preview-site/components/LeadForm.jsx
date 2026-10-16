"use client";

import { useState } from "react";
import { BorderBeam } from "./effects";
import { quoteServices } from "../lib/content";

export function LeadForm({
  title = "Request A Call For More Details",
  submitLabel = "Request A Call",
  showService = false,
  showMessage = false,
  showZip = true,
  names = false,
  tone = "card",
}) {
  const [done, setDone] = useState(false);

  function onSubmit(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const required = ["name", "email", "phone"];
    if (names) required.splice(0, 1, "first", "last");
    if (required.some((key) => !String(data.get(key) || "").trim())) return;
    setDone(true);
  }

  if (done) {
    return (
      <div className={`${tone === "soft" ? "quote-card" : "card"} beam-host`}>
        <BorderBeam />
        <div className="success">
          <strong>Got it — this is a preview.</strong>
          Nothing was sent, and no live inbox was contacted. On the published site this form would reach the NovaraCleaning team.
        </div>
      </div>
    );
  }

  return (
    <form className={`${tone === "soft" ? "quote-card" : "card"} beam-host`} onSubmit={onSubmit}>
      <BorderBeam />
      <h2 className="form-title">{title}</h2>
      {names ? (
        <>
          <label htmlFor="first">First Name</label>
          <input id="first" name="first" autoComplete="given-name" placeholder="Jane" required />
          <label htmlFor="last">Last name</label>
          <input id="last" name="last" autoComplete="family-name" placeholder="Smith" required />
        </>
      ) : (
        <>
          <label htmlFor="name">Name</label>
          <input id="name" name="name" autoComplete="name" placeholder="Jane Smith" required />
        </>
      )}
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" autoComplete="email" placeholder="jane@novaracleaning.com" required />
      <label htmlFor="phone">Phone Number</label>
      <input id="phone" name="phone" type="tel" autoComplete="tel" placeholder="(111) 111-1111" required />
      {showZip ? (
        <>
          <label htmlFor="zip">Zip Code</label>
          <input id="zip" name="zip" inputMode="numeric" placeholder="Zip Code" maxLength={5} />
        </>
      ) : null}
      {showService ? (
        <>
          <label htmlFor="service">Service</label>
          <select id="service" name="service" defaultValue="">
            <option value="" disabled>Select your service...</option>
            {quoteServices.map((service) => (
              <option key={service}>{service}</option>
            ))}
          </select>
        </>
      ) : null}
      {showMessage ? (
        <>
          <label htmlFor="message">{names ? "What specialized cleaning do you offer, and where?" : "How can we help?"}</label>
          <textarea id="message" name="message" placeholder={names ? "Specialty, equipment, and cities you cover" : "How can we help?"} />
        </>
      ) : null}
      <div style={{ height: 14 }} />
      <button className="btn btn-primary btn-block" type="submit">{submitLabel}</button>
      <p className="fine">
        By submitting your contact details, you agree to receive automated SMS/MMS messages from NovaraCleaning. Message and data rates may apply. This preview does not send the form.
      </p>
    </form>
  );
}
