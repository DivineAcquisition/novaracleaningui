"use client";

import { BOOK_URL } from "../lib/content";
import { BorderBeam, NumberTicker } from "./effects";
import { Glyph } from "./Icons";

export function PlanCard({ plan }) {
  return (
    <article className={plan.featured ? "plan featured beam-host" : "plan"}>
      {plan.featured ? <BorderBeam colorFrom="#ffffff" colorTo="#c4b5fd" duration={6} /> : null}
      {plan.featured ? <div className="plan-flag">Novara Recommended</div> : null}
      <div className="plan-body">
        <div className="mini-icon"><Glyph name="calendar" /></div>
        <h3>{plan.name}</h3>
        <p className="who">{plan.audience}</p>
        <p className="price"><NumberTicker value={Number(plan.price.replace(/\D/g, ""))} prefix="$" /> <span>/month</span></p>
      </div>
      <div className="plan-foot">
        <h4>What’s in it for you?</h4>
        <ul>
          {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
        </ul>
        <a className="btn btn-primary btn-block" href={BOOK_URL}>Get started</a>
      </div>
    </article>
  );
}
