export function Spark() {
  return (
    <svg className="spark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2.5l1.6 6.2L20 10.2l-6.4 1.6L12 18l-1.6-6.2L4 10.2l6.4-1.5L12 2.5z" fill="white" />
      <path d="M18.5 14.5l.6 2.1 2.2.6-2.2.6-.6 2.1-.6-2.1-2.2-.6 2.2-.6.6-2.1z" fill="white" opacity=".85" />
    </svg>
  );
}

export function Glyph({ name }) {
  const common = { width: 26, height: 26, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
  if (name === "pin") {
    return (
      <svg {...common}><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" /><circle cx="12" cy="10" r="2.2" /></svg>
    );
  }
  if (name === "clock") {
    return (
      <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 8v4.5l3 2" /></svg>
    );
  }
  if (name === "calendar") {
    return (
      <svg {...common}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3.5V7M16 3.5V7M4 10h16" /><path d="M9 14.5l2 2 4-4" /></svg>
    );
  }
  if (name === "hands") {
    return (
      <svg {...common}><path d="M8 13V7.5a1.5 1.5 0 0 1 3 0V12" /><path d="M11 11.5V6.5a1.5 1.5 0 0 1 3 0V12" /><path d="M14 12V8.5a1.5 1.5 0 0 1 3 0V14c0 3.2-2 6-5.5 6S6 17.5 6 14.5V11a1.5 1.5 0 0 1 3 0v2" /></svg>
    );
  }
  if (name === "people") {
    return (
      <svg {...common}><circle cx="12" cy="8" r="3" /><path d="M6 19.5c.8-3 3-4.5 6-4.5s5.2 1.5 6 4.5" /></svg>
    );
  }
  if (name === "shield") {
    return (
      <svg {...common}><path d="M12 3.5l7 2.5v6.2c0 4.2-2.8 6.8-7 8.3-4.2-1.5-7-4.1-7-8.3V6l7-2.5z" /><path d="M9 12.2l2 2 4-4.2" /></svg>
    );
  }
  if (name === "card") {
    return (
      <svg {...common}><rect x="3.5" y="6" width="17" height="12" rx="2" /><path d="M3.5 10h17" /></svg>
    );
  }
  if (name === "home") {
    return (
      <svg {...common}><path d="M4 11.5L12 4l8 7.5" /><path d="M7 10.5V19h10v-8.5" /></svg>
    );
  }
  return (
    <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M8.5 12.5l2.2 2.2 4.8-5" /></svg>
  );
}
