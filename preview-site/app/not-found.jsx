import Link from "next/link";

export default function NotFound() {
  return (
    <main className="section">
      <div className="wrap center-copy">
        <h1>Page not found</h1>
        <p>That page is not part of this preview.</p>
        <Link className="btn btn-primary" href="/">Back home</Link>
      </div>
    </main>
  );
}
