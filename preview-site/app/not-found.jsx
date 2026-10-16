import Link from "next/link";
import { PageHero } from "../components/effects";

export default function NotFound() {
  return (
    <main>
      <PageHero title="Page not found" lede="That page is not part of this preview.">
        <Link className="btn btn-light" href="/">Back home</Link>
      </PageHero>
    </main>
  );
}
