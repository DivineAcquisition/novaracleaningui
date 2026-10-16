"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icons";

const BEATS = [
  { label: "Checking 20814", detail: "Bethesda, MD is in range" },
  { label: "Price locked · $189", detail: "Standard clean, upfront" },
  { label: "Tuesday · 9:00 AM", detail: "Deposit holds the slot" },
  { label: "Cleaner assigned", detail: "Background-checked and on time" },
];

const CHECKS = ["Kitchen counters", "Bathrooms", "Floors and baseboards", "Before / after photos"];

const BARS = [42, 58, 51, 70, 66, 84, 78, 96];

export function ProductStage() {
  const [beat, setBeat] = useState(0);
  const [done, setDone] = useState(1);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener?.("change", sync);
    return () => media.removeEventListener?.("change", sync);
  }, []);

  useEffect(() => {
    if (reduced) {
      setBeat(BEATS.length - 1);
      setDone(CHECKS.length);
      return undefined;
    }
    const timer = setInterval(() => {
      setBeat((value) => (value + 1) % BEATS.length);
      setDone((value) => (value % CHECKS.length) + 1);
    }, 1800);
    return () => clearInterval(timer);
  }, [reduced]);

  const current = BEATS[beat];

  return (
    <section className="section" style={{ paddingTop: 10 }} aria-label="Live booking preview">
      <div className="wrap">
        <div className="center-copy">
          <p className="stage-kicker">Live booking</p>
          <h2>Watch a clean get booked</h2>
          <p>The same three steps, shown the way they move in the Novara app.</p>
        </div>
        <div className="stage shine-frame">
          <div className="stage-bar">
            <span />
            <span />
            <span />
            <strong>app.novaracleaning.com</strong>
          </div>
          <div className="stage-body">
            <div>
              <p className="stage-status">{current.label}</p>
              <p className="stage-detail">{current.detail}</p>
              <ul className="stage-checks">
                {CHECKS.map((item, index) => (
                  <li key={item} data-on={index < done}>
                    <i>{index < done ? <Icon name="check" size={14} /> : null}</i>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="stage-chart" aria-hidden="true">
              <p>Recurring visits</p>
              <div className="stage-bars">
                {BARS.map((height, index) => (
                  <span key={height} style={{ height: `${reduced ? height : 18 + ((beat + index) % 5) * 14}%` }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
