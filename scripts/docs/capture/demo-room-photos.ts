// ─── Invented before/after "photos" for the photo-upload screens ──────────
//
// The photo screens only look like the real thing with thumbnails in them,
// and a real customer's home can never be the source. So these are flat
// illustrations drawn here, served to the page through the storage mock.
// "Before" has the mess a contractor walks into; "after" is the same room
// cleaned. They are deliberately illustrations, not photo-realistic, so no
// one mistakes a training frame for a real client's house.

export type Room = "kitchen" | "bathroom" | "living" | "bedroom";
export type PhotoState = "before" | "after";

export const ROOMS: Room[] = ["kitchen", "bathroom", "living", "bedroom"];

const sparkle = (x: number, y: number, s = 1) =>
  `<g transform="translate(${x} ${y}) scale(${s})"><circle r="16" fill="#FFF6C9" opacity=".55"/>` +
  `<path d="M0-22C2-6 6-2 22 0 6 2 2 6 0 22-2 6-6 2-22 0-6-2-2-6 0-22Z" fill="#fff"/></g>`;

const spots = (points: Array<[number, number, number]>, fill: string, opacity = 0.7) =>
  points.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" opacity="${opacity}"/>`).join("");

function frame(body: string, state: PhotoState): string {
  // A light wash reads as "lights on, just cleaned"; a warm dim reads as
  // "as found". Both sit under a soft vignette so the tile looks like a photo
  // taken on a phone rather than a flat diagram.
  const wash =
    state === "after"
      ? `<rect width="600" height="600" fill="#fff" opacity=".06"/>`
      : `<rect width="600" height="600" fill="#5a4a2a" opacity=".10"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600">` +
    `<defs><radialGradient id="v" cx=".5" cy=".45" r=".75"><stop offset=".6" stop-color="#000" stop-opacity="0"/>` +
    `<stop offset="1" stop-color="#000" stop-opacity=".28"/></radialGradient></defs>` +
    body +
    wash +
    `<rect width="600" height="600" fill="url(#v)"/></svg>`
  );
}

function kitchen(state: PhotoState): string {
  const dirty = state === "before";
  let s =
    `<rect width="600" height="600" fill="#EFE6D8"/>` +
    // floor
    `<rect y="470" width="600" height="130" fill="#BE9267"/>` +
    `<g stroke="#9E7449" stroke-width="3" opacity=".45"><path d="M0 505H600M0 545H600M0 585H600M120 470V505M330 505V545M210 545V585M480 470V505"/></g>` +
    // upper cabinets
    `<g fill="#FFFFFF" stroke="#D8CDBB" stroke-width="4"><rect x="28" y="36" width="172" height="150" rx="8"/><rect x="214" y="36" width="172" height="150" rx="8"/><rect x="400" y="36" width="172" height="150" rx="8"/></g>` +
    `<g fill="#A99C86"><rect x="178" y="140" width="7" height="32" rx="3.5"/><rect x="230" y="140" width="7" height="32" rx="3.5"/><rect x="416" y="140" width="7" height="32" rx="3.5"/></g>` +
    // backsplash
    `<rect y="186" width="600" height="110" fill="#F7F2E9"/>` +
    `<g stroke="#E3D9C7" stroke-width="2"><path d="M0 222H600M0 259H600M60 186V296M120 186V296M180 186V296M240 186V296M300 186V296M360 186V296M420 186V296M480 186V296M540 186V296"/></g>` +
    // counter + lower cabinets
    `<rect y="292" width="600" height="24" fill="#57524D"/><rect y="292" width="600" height="6" fill="#726B64"/>` +
    `<rect y="316" width="600" height="154" fill="#FFFFFF"/>` +
    `<g fill="none" stroke="#D8CDBB" stroke-width="4"><rect x="18" y="330" width="168" height="126" rx="6"/><rect x="414" y="330" width="168" height="126" rx="6"/></g>` +
    // oven
    `<rect x="204" y="326" width="192" height="134" rx="8" fill="#2E2B31"/><rect x="222" y="358" width="156" height="82" rx="8" fill="#47434D"/><rect x="232" y="336" width="136" height="9" rx="4.5" fill="#8C8791"/>` +
    // burners
    `<g fill="#3B3840"><ellipse cx="248" cy="292" rx="26" ry="5"/><ellipse cx="352" cy="292" rx="26" ry="5"/></g>` +
    // sink + faucet
    `<rect x="446" y="287" width="116" height="10" rx="5" fill="#A2A8AF"/>` +
    `<path d="M494 290V246a22 22 0 0 1 44 0v12" fill="none" stroke="#B9BEC5" stroke-width="8" stroke-linecap="round"/>`;
  if (dirty) {
    s +=
      // stacked dishes + pot on the stove
      `<g stroke="#9AA0A6" stroke-width="3" fill="#FAFAFA"><ellipse cx="410" cy="282" rx="34" ry="8"/><ellipse cx="410" cy="272" rx="30" ry="7"/><ellipse cx="410" cy="263" rx="26" ry="6"/></g>` +
      `<rect x="222" y="244" width="56" height="44" rx="6" fill="#6E737A"/><rect x="198" y="252" width="26" height="7" rx="3" fill="#55595F"/>` +
      // spills and splatter
      `<path d="M92 294c16-10 44-8 60 0 10 6-4 10-22 9-18-1-44 1-38-9z" fill="#7A4B27" opacity=".85"/>` +
      spots([[70, 230, 5], [96, 214, 4], [300, 240, 6], [322, 222, 4], [288, 206, 3], [520, 214, 5], [548, 238, 4]], "#B8742F", 0.6) +
      // towel slung over the oven handle
      `<path d="M300 338c-20 2-26 30-14 58 8 16 26 12 26-8 0-20 8-40-12-50z" fill="#D9695A"/>` +
      // crumbs and a trash bag on the floor
      spots([[140, 500, 4], [170, 520, 3], [360, 512, 4], [400, 530, 3], [300, 560, 4], [250, 575, 3]], "#6B4E33", 0.8) +
      `<path d="M40 470c-8-40 26-58 50-44 22-10 44 12 34 44z" fill="#4A4D52"/><path d="M78 430l-8-14 14 6z" fill="#4A4D52"/>`;
  } else {
    s +=
      // fruit bowl, plant, folded towel
      `<path d="M80 280h92c-4 16-22 24-46 24s-42-8-46-24z" fill="#FFFFFF" stroke="#D8CDBB" stroke-width="3"/>` +
      `<circle cx="108" cy="272" r="12" fill="#F4A53B"/><circle cx="130" cy="268" r="12" fill="#F7B955"/><circle cx="150" cy="274" r="11" fill="#8CC152"/>` +
      `<rect x="556" y="262" width="26" height="30" rx="4" fill="#C98B5E"/><path d="M569 262c-10-24-4-40 6-44-2 16 8 30-6 44zM569 262c8-18 22-24 30-20-10 8-12 20-30 20z" fill="#4FA56B"/>` +
      `<rect x="282" y="340" width="36" height="46" rx="4" fill="#6FA8DC"/><rect x="282" y="352" width="36" height="5" fill="#5B93C7"/>` +
      // shine on the floor
      `<path d="M150 470l80 0-140 130-80 0z" fill="#fff" opacity=".12"/>` +
      sparkle(512, 250, 0.9) + sparkle(160, 300, 0.7) + sparkle(372, 392, 0.8) + sparkle(470, 520, 0.7) + sparkle(84, 110, 0.6);
  }
  return frame(s, state);
}

function bathroom(state: PhotoState): string {
  const dirty = state === "before";
  let s =
    `<rect width="600" height="600" fill="#E1EEF1"/>` +
    `<g stroke="#CBDFE4" stroke-width="2"><path d="M0 60H600M0 120H600M0 180H600M0 240H600M0 300H600M0 360H600M0 420H600M60 0V470M120 0V470M180 0V470M240 0V470M300 0V470M360 0V470M420 0V470M480 0V470M540 0V470"/></g>` +
    `<rect y="470" width="600" height="130" fill="#C3CBD1"/>` +
    `<g stroke="#AEB8BF" stroke-width="2"><path d="M0 510H600M0 555H600M75 470V600M175 470V600M275 470V600M375 470V600M475 470V600"/></g>` +
    // light bar + mirror
    `<rect x="118" y="30" width="144" height="14" rx="7" fill="#F2D68A"/>` +
    `<rect x="84" y="58" width="212" height="176" rx="16" fill="#D3E8F2" stroke="#B9C4CB" stroke-width="7"/>` +
    // vanity, basin, faucet
    `<rect x="52" y="288" width="276" height="16" rx="4" fill="#EEF2F4"/><ellipse cx="190" cy="296" rx="62" ry="10" fill="#D5DEE3"/>` +
    `<path d="M182 290v-18a8 8 0 0 1 16 0" fill="none" stroke="#AAB3BA" stroke-width="6" stroke-linecap="round"/>` +
    `<rect x="62" y="304" width="256" height="166" fill="#FFFFFF" stroke="#D2DADF" stroke-width="3"/>` +
    `<g fill="none" stroke="#D2DADF" stroke-width="3"><rect x="76" y="318" width="108" height="138" rx="5"/><rect x="196" y="318" width="108" height="138" rx="5"/></g>` +
    // toilet
    `<rect x="392" y="252" width="112" height="86" rx="12" fill="#FFFFFF" stroke="#D2DADF" stroke-width="3"/>` +
    `<path d="M384 338h128c0 40-24 64-64 64s-64-24-64-64z" fill="#FFFFFF" stroke="#D2DADF" stroke-width="3"/><rect x="424" y="400" width="48" height="70" fill="#FFFFFF" stroke="#D2DADF" stroke-width="3"/>` +
    // towel bar
    `<rect x="520" y="150" width="70" height="6" rx="3" fill="#AAB3BA"/>`;
  if (dirty) {
    s +=
      // water spots on the mirror, grime ring, toothpaste, fallen towel
      spots([[120, 96, 7], [150, 130, 5], [200, 100, 6], [236, 150, 8], [260, 110, 5], [140, 190, 6], [220, 204, 5], [180, 160, 4]], "#8C9AA3", 0.45) +
      `<ellipse cx="190" cy="296" rx="44" ry="6" fill="none" stroke="#9B7A55" stroke-width="4" opacity=".7"/>` +
      `<path d="M92 290c12-6 24-4 30 2-8 4-22 4-30-2zM256 292c8-4 20-4 26 2-6 3-18 3-26-2z" fill="#9FD3E6"/>` +
      `<rect x="266" y="262" width="16" height="30" rx="4" fill="#E9A23B" transform="rotate(58 274 277)"/><rect x="300" y="268" width="14" height="22" rx="4" fill="#6CB28E"/>` +
      `<path d="M300 520c30-30 90-26 120 6 10 14-28 22-60 20-40-2-72-8-60-26z" fill="#E48C79"/>` +
      spots([[120, 520, 3], [160, 560, 2.5], [240, 540, 3], [460, 575, 3], [520, 520, 2.5]], "#5C5048", 0.8);
  } else {
    s +=
      // clean glass shine, folded towels, a plant
      `<path d="M120 70l60 0-80 150-12 0-4-20z" fill="#fff" opacity=".45"/><path d="M200 70l24 0-80 150-24 0z" fill="#fff" opacity=".3"/>` +
      `<rect x="528" y="156" width="54" height="64" rx="6" fill="#7CB6C8"/><rect x="528" y="170" width="54" height="6" fill="#68A2B5"/>` +
      `<rect x="92" y="262" width="22" height="28" rx="4" fill="#FFFFFF" stroke="#D2DADF" stroke-width="2"/><path d="M103 262c-8-18-2-30 6-34-2 12 6 24-6 34zM103 262c6-14 18-18 24-14-8 6-10 16-24 14z" fill="#4FA56B"/>` +
      sparkle(250, 110, 0.9) + sparkle(160, 296, 0.6) + sparkle(470, 300, 0.8) + sparkle(330, 530, 0.7) + sparkle(540, 250, 0.55);
  }
  return frame(s, state);
}

function living(state: PhotoState): string {
  const dirty = state === "before";
  let s =
    `<rect width="600" height="600" fill="#EAE5F4"/>` +
    `<rect y="430" width="600" height="170" fill="#B98C62"/>` +
    `<g stroke="#9C7148" stroke-width="3" opacity=".4"><path d="M0 470H600M0 515H600M0 560H600M90 430V470M300 470V515M180 515V560M450 430V470M520 515V560"/></g>` +
    // window + curtains
    `<rect x="376" y="54" width="170" height="196" rx="6" fill="#FFFFFF"/><rect x="388" y="66" width="146" height="172" fill="#BFE2F4"/>` +
    `<path d="M461 66V238M388 152H534" stroke="#FFFFFF" stroke-width="6"/>` +
    `<path d="M356 44h30c-6 70 4 150 14 216h-44z" fill="#9D8FD8"/><path d="M566 44h-30c6 70-4 150-14 216h44z" fill="#9D8FD8"/>` +
    // art
    `<rect x="84" y="78" width="210" height="112" rx="4" fill="#FFFFFF" stroke="#C7BFDD" stroke-width="5"/><circle cx="150" cy="134" r="28" fill="#F2B84B"/><path d="M96 180l70-54 44 34 38-24 34 44z" fill="#7D6BC4"/>` +
    // rug, sofa, table, lamp
    `<ellipse cx="250" cy="492" rx="232" ry="58" fill="#D7CDEE"/>` +
    `<rect x="44" y="246" width="316" height="84" rx="22" fill="#687AA3"/><rect x="30" y="300" width="344" height="92" rx="20" fill="#7486AE"/>` +
    `<rect x="24" y="286" width="42" height="116" rx="18" fill="#5E6F97"/><rect x="340" y="286" width="42" height="116" rx="18" fill="#5E6F97"/>` +
    `<rect x="136" y="436" width="228" height="16" rx="6" fill="#8A5C3A"/><rect x="152" y="452" width="10" height="34" fill="#74492B"/><rect x="338" y="452" width="10" height="34" fill="#74492B"/>` +
    `<rect x="562" y="266" width="6" height="196" fill="#5B5364"/><path d="M536 226h58l-12 44h-34z" fill="#F4E3B5"/>`;
  if (dirty) {
    s +=
      // cushions thrown about, blanket in a heap, cups and papers, crumbs
      `<rect x="70" y="262" width="70" height="56" rx="14" fill="#F2C14E" transform="rotate(-24 105 290)"/>` +
      `<rect x="250" y="270" width="66" height="54" rx="14" fill="#E57373" transform="rotate(31 283 297)"/>` +
      `<path d="M168 318c30-26 88-20 104 6 12 22-20 36-54 30-30-6-64-12-50-36z" fill="#7FB3A6"/>` +
      `<rect x="176" y="420" width="54" height="36" fill="#FFFFFF" transform="rotate(-12 203 438)"/><rect x="220" y="416" width="48" height="34" fill="#F4F1FA" transform="rotate(9 244 433)"/>` +
      `<rect x="300" y="412" width="22" height="26" rx="4" fill="#FFFFFF" stroke="#B4A9C9" stroke-width="3"/>` +
      spots([[120, 480, 4], [160, 510, 3], [220, 470, 3.5], [300, 500, 4], [360, 520, 3], [420, 486, 3.5]], "#F1E2B8", 0.95) +
      `<path d="M460 520c10-14 36-16 48 0-8 10-38 10-48 0z" fill="#3C3A44"/>` +
      spots([[40, 440, 10], [560, 470, 8]], "#9C98A6", 0.45);
  } else {
    s +=
      // cushions squared up, folded throw, vase, vacuum lines on the rug
      `<rect x="72" y="262" width="66" height="54" rx="14" fill="#F2C14E"/><rect x="266" y="262" width="66" height="54" rx="14" fill="#E57373"/>` +
      `<rect x="340" y="282" width="42" height="40" rx="8" fill="#7FB3A6"/>` +
      `<rect x="232" y="406" width="26" height="30" rx="8" fill="#FFFFFF" stroke="#C7BFDD" stroke-width="3"/><circle cx="238" cy="400" r="9" fill="#EF7C8E"/><circle cx="252" cy="396" r="9" fill="#F2B84B"/><circle cx="245" cy="386" r="8" fill="#7D6BC4"/>` +
      `<g stroke="#E6DEF7" stroke-width="12" opacity=".8"><path d="M90 470h320M70 496h360M90 522h320"/></g>` +
      sparkle(300, 440, 0.8) + sparkle(120, 300, 0.6) + sparkle(470, 140, 0.7) + sparkle(420, 540, 0.65);
  }
  return frame(s, state);
}

function bedroom(state: PhotoState): string {
  const dirty = state === "before";
  let s =
    `<rect width="600" height="600" fill="#F4E8EE"/>` +
    `<rect y="450" width="600" height="150" fill="#C29A73"/>` +
    `<g stroke="#A47B53" stroke-width="3" opacity=".4"><path d="M0 490H600M0 535H600M0 580H600M150 450V490M380 490V535M240 535V580"/></g>` +
    `<rect x="226" y="54" width="148" height="80" rx="4" fill="#FFFFFF" stroke="#D9C3CF" stroke-width="5"/><path d="M238 124l40-40 30 26 22-16 32 30z" fill="#C98FAF"/>` +
    // headboard, bed, nightstand + lamp
    `<rect x="104" y="150" width="392" height="126" rx="22" fill="#8E7CC3"/>` +
    `<rect x="86" y="262" width="428" height="150" rx="16" fill="#FFFFFF" stroke="#E0D6EE" stroke-width="4"/>` +
    `<rect x="520" y="322" width="72" height="100" rx="6" fill="#C8A07B"/><rect x="532" y="344" width="48" height="6" rx="3" fill="#A9805C"/>` +
    `<rect x="548" y="282" width="8" height="40" fill="#8A7B92"/><path d="M528 250h48l-8 34h-32z" fill="#F4E3B5"/>`;
  if (dirty) {
    s +=
      // rumpled duvet, pillows tossed, clothes on the floor, mug left out
      `<path d="M86 300c60-30 110 20 170-6s120-20 160 4 60 6 98-10V412H86z" fill="#D8CFEE"/>` +
      `<g fill="none" stroke="#B8AAD9" stroke-width="5" stroke-linecap="round"><path d="M130 340c30-12 60 10 90-4M260 330c40-16 80 14 120 0M180 380c40-10 80 12 130-2"/></g>` +
      `<rect x="130" y="238" width="120" height="54" rx="20" fill="#FFFFFF" stroke="#E0D6EE" stroke-width="4" transform="rotate(-16 190 265)"/>` +
      `<rect x="330" y="250" width="116" height="52" rx="20" fill="#FFFFFF" stroke="#E0D6EE" stroke-width="4" transform="rotate(22 388 276)"/>` +
      `<path d="M120 470l40-10 30 20 34-8-6 40-32 6-24-18-36 6z" fill="#5C7AEA"/><path d="M380 500c20-20 70-22 96-2l-6 30c-24-8-52-8-84 4z" fill="#3E5C8A"/>` +
      `<rect x="536" y="300" width="22" height="22" rx="4" fill="#FFFFFF" stroke="#B4A9C9" stroke-width="3"/>`;
  } else {
    s +=
      // made bed: smooth duvet, sheet fold, squared pillows, throw at the foot
      `<rect x="86" y="300" width="428" height="112" rx="10" fill="#E6DFF6"/><rect x="86" y="296" width="428" height="14" fill="#FFFFFF"/>` +
      `<rect x="86" y="368" width="428" height="26" fill="#8E7CC3"/>` +
      `<rect x="132" y="244" width="136" height="50" rx="18" fill="#FFFFFF" stroke="#E0D6EE" stroke-width="4"/><rect x="332" y="244" width="136" height="50" rx="18" fill="#FFFFFF" stroke="#E0D6EE" stroke-width="4"/>` +
      `<rect x="266" y="258" width="68" height="40" rx="12" fill="#C98FAF"/>` +
      `<rect x="532" y="304" width="10" height="18" rx="3" fill="#FFFFFF"/><circle cx="537" cy="298" r="8" fill="#4FA56B"/>` +
      sparkle(160, 340, 0.7) + sparkle(430, 330, 0.8) + sparkle(300, 520, 0.7) + sparkle(560, 230, 0.55);
  }
  return frame(s, state);
}

const DRAW: Record<Room, (state: PhotoState) => string> = { kitchen, bathroom, living, bedroom };

export function roomPhotoSvg(room: Room, state: PhotoState): string {
  return DRAW[room](state);
}

/** Storage path segment the mock serves, e.g. "demo-room-photos/kitchen-before.svg". */
export function roomPhotoKey(room: Room, state: PhotoState): string {
  return `demo-room-photos/${room}-${state}.svg`;
}
