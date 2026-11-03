import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>Specs</h1>
      <p className="muted">
        Turns a small business&rsquo;s messy brand materials into an agent-readable brand kit, then art-directs
        on-brand Instagram posts that explain their own design decisions.
      </p>
      <p>
        Work in progress. You can <Link href="/build">build a brand kit</Link> from your own materials and watch it
        assemble, each item tagged with the upload it came from. The <Link href="/live">live session test page</Link>{" "}
        checks the cost guards on post generation.
      </p>
      <p className="muted">Half Acre Club, the demo brand, is fictional.</p>
    </main>
  );
}
