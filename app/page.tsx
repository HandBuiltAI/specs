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
        This is the phase 3 scaffold. The real screens arrive in later phases. For now there&rsquo;s a{" "}
        <Link href="/live">live session test page</Link> for checking the cost guards.
      </p>
      <p className="muted">Half Acre Club, the demo brand, is fictional.</p>
    </main>
  );
}
