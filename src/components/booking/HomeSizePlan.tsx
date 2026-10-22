"use client";

import { cn } from "@/lib/utils";

/** Room grids from a studio up to a wide house. Repeated grids grow by footprint. */
const GRIDS: Array<readonly [number, number]> = [
  [1, 1],
  [2, 1],
  [2, 2],
  [2, 2],
  [3, 2],
  [3, 2],
  [3, 3],
  [4, 2],
  [4, 3],
];

/**
 * Top-down plan for one square-footage range.
 * The dashed lot stays the same size. The house grows inside it and gains rooms.
 */
export function HomeSizePlan({
  index,
  total,
  selected,
}: {
  index: number;
  total: number;
  selected: boolean;
}) {
  const t = total <= 1 ? 1 : index / Math.max(1, total - 1);
  const [cols, rows] = GRIDS[Math.min(index, GRIDS.length - 1)];
  const lot = { x: 16, y: 8, w: 128, h: 86 };
  const scale = 0.42 + t * 0.58;
  const w = lot.w * scale;
  const h = lot.h * scale;
  const x = lot.x + (lot.w - w) / 2;
  const y = lot.y + lot.h - h;
  const door = Math.min(12, Math.max(7, w * 0.22));
  const doorX = x + w / 2 - door / 2;
  const cellW = w / cols;
  const cellH = h / rows;

  const interior: string[] = [];
  for (let col = 1; col < cols; col += 1) {
    interior.push(`M ${x + col * cellW} ${y} V ${y + h}`);
  }
  for (let row = 1; row < rows; row += 1) {
    interior.push(`M ${x} ${y + row * cellH} H ${x + w}`);
  }

  return (
    <svg
      viewBox="0 0 160 108"
      className={cn("mx-auto h-[4.75rem] w-full max-w-[11rem]", selected ? "text-primary" : "text-primary/75")}
      aria-hidden
    >
      <rect
        x={lot.x}
        y={lot.y}
        width={lot.w}
        height={lot.h}
        rx="6"
        fill="none"
        className="stroke-border"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx="1.5"
        className={selected ? "fill-primary/20" : "fill-primary/10"}
      />
      <path
        d={[
          `M ${x} ${y + h}`,
          `V ${y}`,
          `H ${x + w}`,
          `V ${y + h}`,
          `H ${doorX + door}`,
          `M ${doorX} ${y + h}`,
          `H ${x}`,
        ].join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      {interior.length > 0 ? (
        <path d={interior.join(" ")} fill="none" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      ) : null}
      <path
        d={`M ${doorX} ${y + h} A ${door} ${door} 0 0 0 ${doorX + door} ${y + h}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.8"
      />
      {Array.from({ length: cols }, (_, col) => {
        const left = x + col * cellW;
        return (
          <line
            key={col}
            x1={left + cellW * 0.3}
            x2={left + cellW * 0.7}
            y1={y + 3.2}
            y2={y + 3.2}
            stroke="currentColor"
            strokeWidth="1.2"
            opacity="0.4"
          />
        );
      })}
    </svg>
  );
}
