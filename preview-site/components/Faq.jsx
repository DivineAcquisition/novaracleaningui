"use client";

import { useState } from "react";
import Link from "next/link";
import { faqs } from "../lib/content";

export function Faq() {
  const [open, setOpen] = useState(0);
  return (
    <section className="section">
      <div className="wrap faq-grid">
        <div className="faq-intro">
          <h2>Your questions, answered</h2>
          <p>Answers to the most common questions our customers have. If you don’t find the information you’re looking for, feel free to contact us.</p>
          <Link className="btn btn-primary" href="/contact">Contact Us</Link>
        </div>
        <div>
          {faqs.map((item, index) => {
            const expanded = open === index;
            return (
              <div className="faq-item" key={item.q}>
                <button aria-expanded={expanded} onClick={() => setOpen(expanded ? -1 : index)}>
                  <span>{item.q}</span>
                  <span aria-hidden="true">{expanded ? "–" : "→"}</span>
                </button>
                {expanded ? <div className="answer">{item.a}</div> : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
