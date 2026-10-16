"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useMotionTemplate, useMotionValue } from "motion/react";
import { BOOK_URL } from "../lib/content";

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
      for (const dot of dots) {
        dot.y -= dot.s;
        if (dot.y < -2) dot.y = height + 2;
        ctx.globalAlpha = 0.35 + dot.r / 3;
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
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

export function BookDock() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    function onScroll() {
      setShow(window.scrollY > 640);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  if (!show) return null;
  return (
    <a className="book-dock btn btn-primary" href={BOOK_URL}>
      Book 50% Off
    </a>
  );
}

export function PageHero({ title, lede, children }) {
  return (
    <section className="hero page-hero">
      <Particles density={28} />
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
