"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useMotionTemplate, useMotionValue } from "motion/react";

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function Particles({ color = "rgba(255,255,255,0.85)", density = 42 }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || reducedMotion()) return;
    const ctx = canvas.getContext("2d");
    let frame = 0;
    let dots = [];

    function size() {
      const { width, height } = canvas.parentElement.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      dots = Array.from({ length: density }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 1.6 + 0.4,
        s: Math.random() * 0.35 + 0.08,
      }));
    }

    function draw() {
      const { width, height } = canvas.parentElement.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = color;
      const drift = window.scrollY * 0.08;
      for (const dot of dots) {
        dot.y -= dot.s;
        if (dot.y < -2) dot.y = height + 2;
        ctx.globalAlpha = 0.35 + dot.r / 3;
        ctx.beginPath();
        ctx.arc(dot.x, dot.y - drift, dot.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      frame = requestAnimationFrame(draw);
    }

    size();
    draw();
    window.addEventListener("resize", size);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", size);
    };
  }, [color, density]);

  return <canvas ref={ref} className="particles" aria-hidden="true" />;
}

export function BlurFade({ children, delay = 0, className = "" }) {
  const [skip, setSkip] = useState(false);
  useEffect(() => setSkip(reducedMotion()), []);
  if (skip) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.45, delay, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

export function BorderBeam({ size = 88, duration = 7, colorFrom = "#ffffff", colorTo = "#d8c7ff" }) {
  return (
    <div className="border-beam" aria-hidden="true">
      <motion.div
        style={{
          width: size,
          offsetPath: `rect(0 auto auto 0 round ${size}px)`,
          background: `linear-gradient(to left, ${colorFrom}, ${colorTo}, transparent)`,
        }}
        initial={{ offsetDistance: "0%" }}
        animate={{ offsetDistance: "100%" }}
        transition={{ repeat: Infinity, ease: "linear", duration }}
      />
    </div>
  );
}

export function TiltCard({ children, className = "" }) {
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  return (
    <motion.div
      className={className}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 900 }}
      onMouseMove={(event) => {
        if (reducedMotion()) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const px = (event.clientX - rect.left) / rect.width - 0.5;
        const py = (event.clientY - rect.top) / rect.height - 0.5;
        ry.set(px * 7);
        rx.set(py * -7);
      }}
      onMouseLeave={() => {
        rx.set(0);
        ry.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}

export function MagicCard({ children, className = "" }) {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const hover = useMotionValue(0);
  const spotlight = useMotionTemplate`radial-gradient(220px circle at ${mouseX}px ${mouseY}px, rgba(255,255,255,0.42), transparent 68%)`;

  return (
    <div
      className={className}
      onPointerEnter={() => hover.set(1)}
      onPointerLeave={() => hover.set(0)}
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        mouseX.set(event.clientX - rect.left);
        mouseY.set(event.clientY - rect.top);
      }}
    >
      {children}
      <motion.div aria-hidden className="magic-spot" style={{ background: spotlight, opacity: hover }} />
    </div>
  );
}

export function ShinyText({ children, light = false }) {
  return <span className={light ? "shiny shiny-light" : "shiny"}>{children}</span>;
}

export function ScrollProgress() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    function onScroll() {
      const height = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(height > 0 ? window.scrollY / height : 0);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return <div className="scroll-progress" style={{ transform: `scaleX(${progress})` }} />;
}

export function NumberTicker({ value, prefix = "" }) {
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    if (reducedMotion()) return undefined;
    const startValue = Math.round(value * 0.72);
    const start = performance.now();
    let frame = 0;
    setCurrent(startValue);
    function tick(now) {
      const progress = Math.min(1, (now - start) / 700);
      setCurrent(Math.round(startValue + (value - startValue) * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <span>{prefix}{current}</span>;
}

export function HeroSpotlight() {
  const ref = useRef(null);
  const x = useMotionValue(70);
  const y = useMotionValue(40);
  const glow = useMotionTemplate`radial-gradient(460px circle at ${x}% ${y}%, rgba(255,255,255,0.2), transparent 62%)`;

  useEffect(() => {
    const node = ref.current?.parentElement;
    if (!node || reducedMotion()) return undefined;
    function move(event) {
      const rect = node.getBoundingClientRect();
      x.set(((event.clientX - rect.left) / rect.width) * 100);
      y.set(((event.clientY - rect.top) / rect.height) * 100);
    }
    node.addEventListener("mousemove", move);
    return () => node.removeEventListener("mousemove", move);
  }, [x, y]);

  return <motion.div ref={ref} aria-hidden className="hero-spot" style={{ background: glow }} />;
}

export function PageHero({ title, lede, children }) {
  return (
    <section className="hero page-hero">
      <HeroSpotlight />
      <BlurFade>
        <div className="wrap">
          {title ? <h1>{title}</h1> : null}
          {lede ? <p className="lede">{lede}</p> : null}
          <div className="promise-row">
            <span>Insured</span>
            <span>Bonded</span>
            <span>Background-checked</span>
          </div>
          {children}
        </div>
      </BlurFade>
    </section>
  );
}

export function Marquee({ items }) {
  const loop = [...items, ...items];
  return (
    <div className="marquee" aria-label="Service area">
      <div className="marquee-track">
        {loop.map((item, index) => (
          <span key={`${item}-${index}`}>{item}</span>
        ))}
      </div>
    </div>
  );
}
