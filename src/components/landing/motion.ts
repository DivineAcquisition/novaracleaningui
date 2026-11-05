"use client";

// Motion helpers. Every animation holds its final frame when the visitor asks
// for reduced motion.

import { useEffect, useRef, useState, type RefObject } from "react";

export function prefersStill(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Steps through `length` frames on a timer while on screen; holds the last frame when still. */
export function useCycle(length: number, interval = 2400, active = true) {
  const [index, setIndex] = useState<number | "still">("still");
  useEffect(() => {
    if (!active || prefersStill()) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current === "still" ? 0 : (current + 1) % length));
    }, interval);
    return () => window.clearInterval(timer);
  }, [interval, length, active]);
  return index === "still" ? length - 1 : index;
}

/**
 * Counts from 0 to `total` once the element scrolls into view. Returns `total`
 * immediately when motion is reduced, so the resting frame is the finished one.
 */
export function useInViewSequence(ref: RefObject<HTMLElement | null>, total: number, interval = 800) {
  const [count, setCount] = useState<number | "still">("still");
  useEffect(() => {
    const node = ref.current;
    if (!node || prefersStill() || typeof IntersectionObserver === "undefined") return;
    setCount(0);
    let timer: number | undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        timer = window.setInterval(() => {
          setCount((current) => {
            const next = (current === "still" ? total : current) + 1;
            if (next >= total && timer) window.clearInterval(timer);
            return Math.min(next, total);
          });
        }, interval);
      },
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (timer) window.clearInterval(timer);
    };
  }, [interval, ref, total]);
  return count === "still" ? total : count;
}

/** True while the element is on screen. */
export function useOnScreen<T extends Element>(threshold = 0.15) {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return { ref, visible };
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** Eases a number toward its target; jumps straight there under reduced motion. */
export function useAnimatedNumber(target: number, reduced: boolean, durationMs = 450): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    if (reduced) {
      fromRef.current = target;
      setValue(target);
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const q = Math.min(1, (now - start) / durationMs);
      const v = from + (target - from) * (1 - Math.pow(1 - q, 3));
      fromRef.current = v;
      setValue(v);
      if (q < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced, durationMs]);
  return value;
}

/** Smooth-scrolls to the hero ZIP form and focuses it. */
export function scrollToBooking() {
  const form = document.getElementById("get-price");
  if (!form) {
    window.location.assign("/#get-price");
    return;
  }
  form.scrollIntoView({ behavior: prefersStill() ? "auto" : "smooth", block: "center" });
  window.setTimeout(() => {
    const zip = document.getElementById("zipCode") || document.getElementById("firstName");
    zip?.focus({ preventScroll: true });
  }, 450);
}
