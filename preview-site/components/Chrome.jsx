"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BorderBeam, Marquee, ShinyText } from "./effects";
import { Icon } from "./Icons";
import { BOOK_URL, footer, nav, promises, SIGN_IN_URL } from "../lib/content";

function currentNav(pathname, href) {
  if (href === "/") return pathname === "/";
  if (href.startsWith("/#")) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Header() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  return (
    <header className="site-header">
      <div className="wrap">
        <div className="nav-pill">
          <BorderBeam size={70} duration={8} colorFrom="#8d5cff" colorTo="#ffffff" />
          <Link className="brand" href="/" onClick={() => setOpen(false)}>
            <img src="/images/logo.png" alt="" />
            NovaraCleaning
          </Link>
          <nav className="nav-links" aria-label="Primary">
            {nav.map((item) => (
              <Link className={currentNav(pathname, item.href) ? "is-current" : undefined} key={item.label} href={item.href}>{item.label}</Link>
            ))}
          </nav>
          <div className="nav-actions">
            <a className="btn btn-ghost" href={SIGN_IN_URL}>Sign In</a>
            <a className="btn btn-primary" href={BOOK_URL}>Book Now</a>
          </div>
          <button className="menu-btn" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            <span />
          </button>
        </div>
        <div className={open ? "mobile-panel open" : "mobile-panel"}>
          {nav.map((item) => (
            <Link key={item.label} href={item.href} onClick={() => setOpen(false)}>{item.label}</Link>
          ))}
          <a className="btn btn-ghost" href={SIGN_IN_URL}>Sign In</a>
          <a className="btn btn-primary" href={BOOK_URL}>Book Now</a>
        </div>
      </div>
    </header>
  );
}

export function CtaBand() {
  return (
    <section className="cta-band">
      <div className="wrap cta-inner">
        <h2>Book Your Cleaning Now For Only <ShinyText>50% Off</ShinyText></h2>
        <a className="btn btn-light" href={BOOK_URL}>Book My Cleaning Now!</a>
      </div>
    </section>
  );
}

function FooterLink({ item }) {
  if (item.external) return <a href={item.href}>{item.label}</a>;
  return <Link href={item.href}>{item.label}</Link>;
}

export function Footer() {
  const columns = [
    ["Main Selections", "main"],
    ["Legal", "legal"],
    ["Services", "services"],
  ];
  return (
    <footer className="site-footer">
      <Marquee items={promises} />
      <div className="wrap footer-grid">
        <div>
          <Link className="brand" href="/">
            <img src="/images/logo.png" alt="" />
            NovaraCleaning
          </Link>
          <p style={{ marginTop: 10 }}>Top-notch premium residential cleaning service</p>
          <div className="socials" aria-label="Social">
            <a href="https://facebook.com/" aria-label="Facebook"><Icon name="facebook" size={16} /></a>
            <a href="https://twitter.com/" aria-label="X"><Icon name="x" size={16} /></a>
            <a href="https://instagram.com/" aria-label="Instagram"><Icon name="instagram" size={16} /></a>
          </div>
          <img className="guarantee" src="/images/google-guaranteed.png" alt="Google Guaranteed. Professionals that are licensed, pre-screened, and insured." />
        </div>
        {columns.map(([title, key]) => (
          <div key={key}>
            <h4>{title}</h4>
            {footer[key].map((item) => (
              <FooterLink key={item.label} item={item} />
            ))}
          </div>
        ))}
      </div>
      <div className="legal-line">© 2026 NovaraCleaning™, All Rights Reserved</div>
    </footer>
  );
}
