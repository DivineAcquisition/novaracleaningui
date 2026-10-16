export function Icon({ name, size = 22 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.check}
    </svg>
  );
}

export function Glyph({ name }) {
  return <Icon name={name} size={26} />;
}

const paths = {
  pin: (
    <>
      <path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.25" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.5l3 1.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3.5V7M16 3.5V7M4 10h16" />
      <path d="M9 15.2l1.8 1.8 4-4" />
    </>
  ),
  handshake: (
    <>
      <path d="M8 13.5 4.5 11a2 2 0 0 1 0-3L8 5.5" />
      <path d="M16 13.5 19.5 11a2 2 0 0 0 0-3L16 5.5" />
      <path d="M8 13.5 11 16a2 2 0 0 0 2.8 0L16 13.5" />
      <path d="M9 10.5 12 13l3-2.5" />
    </>
  ),
  hands: (
    <>
      <path d="M8 13.5 4.5 11a2 2 0 0 1 0-3L8 5.5" />
      <path d="M16 13.5 19.5 11a2 2 0 0 0 0-3L16 5.5" />
      <path d="M8 13.5 11 16a2 2 0 0 0 2.8 0L16 13.5" />
      <path d="M9 10.5 12 13l3-2.5" />
    </>
  ),
  repeat: (
    <>
      <path d="M17 3.5v4h-4" />
      <path d="M7 20.5v-4h4" />
      <path d="M6.2 9A7 7 0 0 1 17 7.2L17 7.5" />
      <path d="M17.8 15A7 7 0 0 1 7 16.8L7 16.5" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="2.4" />
      <circle cx="16.5" cy="9" r="1.9" />
      <path d="M4.5 18.5c.7-2.6 2.6-4 4.5-4s3.8 1.4 4.5 4" />
      <path d="M14 14.8c1.2-.4 2.5 0 3.4 1.2.6.8 1 1.7 1.1 2.5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="2.4" />
      <circle cx="16.5" cy="9" r="1.9" />
      <path d="M4.5 18.5c.7-2.6 2.6-4 4.5-4s3.8 1.4 4.5 4" />
      <path d="M14 14.8c1.2-.4 2.5 0 3.4 1.2.6.8 1 1.7 1.1 2.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 19 6v5.8c0 4.1-2.8 6.6-7 8.2-4.2-1.6-7-4.1-7-8.2V6l7-2.5z" />
      <path d="M9 12.2 11 14.2 15.2 10" />
    </>
  ),
  clipboard: (
    <>
      <rect x="6" y="4.5" width="12" height="16" rx="2" />
      <path d="M9 4.5h6v2.2H9z" />
      <path d="M9 11h6M9 14.5h4" />
    </>
  ),
  card: (
    <>
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <path d="M3.5 10h17" />
    </>
  ),
  home: (
    <>
      <path d="M4 11.2 12 4.5l8 6.7" />
      <path d="M7 10.2V19h10v-8.8" />
    </>
  ),
  badge: (
    <>
      <circle cx="12" cy="9" r="3" />
      <path d="M8.2 13.2 7 20l5-2.2L17 20l-1.2-6.8" />
    </>
  ),
  check: <path d="M5 12.5 9.2 17 19 7" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  swap: (
    <>
      <path d="M4 8h13M14 5l3 3-3 3" />
      <path d="M20 16H7M10 13l-3 3 3 3" />
    </>
  ),
  chevron: <path d="M9 6l6 6-6 6" />,
  briefcase: (
    <>
      <rect x="3.5" y="7" width="17" height="12" rx="2" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3.5 12h17" />
    </>
  ),
  money: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5v9M9.5 9.2c.6-.7 1.5-1 2.5-1 1.6 0 2.6.8 2.6 2s-1 1.8-2.6 2.1c-1.5.3-2.5.9-2.5 2.1 0 1.2 1 2.1 2.6 2.1 1 0 1.9-.3 2.5-1" />
    </>
  ),
  facebook: <path d="M14 8h2V5h-2c-2.2 0-4 1.8-4 4v2H8v3h2v6h3v-6h2.2l.8-3H13V9c0-.6.4-1 1-1z" />,
  x: <path d="M5 5l14 14M19 5 5 19" />,
  instagram: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <circle cx="12" cy="12" r="3.5" />
      <circle cx="17.2" cy="6.8" r="0.8" fill="currentColor" stroke="none" />
    </>
  ),
};
