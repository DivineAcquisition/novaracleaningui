"use client";

import { useState } from "react";
import { comparisons } from "../lib/content";

function Pair({ item }) {
  const [pos, setPos] = useState(50);
  return (
    <div className="compare" style={{ "--pos": `${pos}%` }}>
      <img src={item.before} alt={`${item.label} before cleaning`} />
      <img className="after" src={item.after} alt={`${item.label} after cleaning`} />
      <span className="tag before">Before</span>
      <span className="tag after">After</span>
      <div className="handle"><i>↔</i></div>
      <input
        type="range"
        min="5"
        max="95"
        value={pos}
        aria-label={`Compare ${item.label} before and after`}
        onChange={(event) => setPos(Number(event.target.value))}
      />
    </div>
  );
}

export function Compare() {
  return (
    <section className="section" style={{ paddingTop: 20 }}>
      <div className="wrap">
        <div className="center-copy">
          <p style={{ letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 800, fontSize: 12, color: "#7a45f6" }}>Proven Results</p>
          <h2>See the Difference We Make</h2>
          <p>Watch your space transform with our professional touch. Drag the slider on each photo.</p>
        </div>
        <div className="compare-grid">
          {comparisons.map((item) => <Pair key={item.label} item={item} />)}
        </div>
      </div>
    </section>
  );
}
