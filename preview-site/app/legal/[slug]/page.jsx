import fs from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { PageHero } from "../../../components/effects";
import { legalPages } from "../../../lib/content";

export function generateStaticParams() {
  return Object.keys(legalPages).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const page = legalPages[slug];
  return { title: page ? `${page.title} | NovaraCleaning™` : "NovaraCleaning™" };
}

function isHeading(line) {
  if (line.length > 92) return false;
  if (/^Last Updated:/i.test(line)) return false;
  if (/^Questions about booking/i.test(line)) return false;
  if (/^IMPORTANT LEGAL NOTICE/i.test(line)) return false;
  if (/^\d+(\.\d+)*\s+[A-Z0-9]/.test(line)) return true;
  if (line === line.toUpperCase() && /[A-Z]/.test(line) && line.length > 3) return true;
  return false;
}

export default async function LegalPage({ params }) {
  const { slug } = await params;
  const page = legalPages[slug];
  if (!page) notFound();
  const file = path.join(process.cwd(), "content/legal", page.file);
  const raw = fs.readFileSync(file, "utf8");
  const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);

  return (
    <main>
      <PageHero title={page.title} lede="Last updated on the live NovaraCleaning policies. This preview copies that text so you can read it here." />
      <section className="section">
        <article className="wrap legal">
          {lines.map((line, index) => {
            const notice = /^IMPORTANT LEGAL NOTICE/i.test(line) || /^Questions about booking/i.test(line);
            const heading = isHeading(line);
            const className = notice ? "block notice" : heading ? "block heading" : "block";
            return <p className={className} key={`${index}-${line.slice(0, 24)}`}>{line}</p>;
          })}
        </article>
      </section>
    </main>
  );
}
