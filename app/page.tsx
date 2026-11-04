import Link from "next/link";

export default function Home() {
  return (
    <main>
      <p className="eyebrow">Work in progress</p>
      <h1>
        Your brand, <span>written down for machines.</span>
      </h1>
      <p className="muted">
        Specs turns a small business&rsquo;s messy brand materials into an agent-readable brand kit, then art-directs
        on-brand Instagram posts that explain their own design decisions.
      </p>
      <p>
        <Link href="/posts/half-acre-club">See a demo brand&rsquo;s posts</Link>, each with the reasons behind it and the same
        brief made without a kit. <Link href="/build">Build a brand kit</Link> from your own materials and watch it assemble, each item tagged with
        the upload it came from. <Link href="/catalog">See the components</Link> the intake agent uses to ask you about
        the gaps. The <Link href="/live">live session test page</Link> checks the cost guards on post generation.
      </p>
      <p className="muted small">Half Acre Club, the demo brand, is fictional.</p>
    </main>
  );
}
