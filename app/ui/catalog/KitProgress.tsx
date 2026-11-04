"use client";

// How complete the kit is: a big count, a tuner-style ruler filled to the same point, and each
// chunk with its state. Red dots are the chunks that need the person.
import type { PropsOf } from "../../../core/catalog.ts";
import { Shell, Skeleton, type Status } from "../primitives.tsx";

type Props = PropsOf<"KitProgress"> & { status?: Status; errorText?: string };

const STATE_LABEL = { complete: "Complete", "needs-review": "Needs your review", missing: "Not started" } as const;

export function KitProgress({ chunks, status, errorText }: Props) {
  const done = chunks.filter((c) => c.status === "complete").length;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <Shell name="KitProgress" writesTo={null} status={status} errorText={errorText} skeleton={<Skeleton block={80} lines={4} />}>
      <div className="c-kp-num" aria-label={`${done} of ${chunks.length} chunks complete`}>
        {pad(done)}
        <span>/{pad(chunks.length)}</span>
      </div>
      <div className="c-ruler" aria-hidden="true">
        <div style={{ width: `${(done / chunks.length) * 100}%` }} />
      </div>
      <ul className="c-kp-list">
        {chunks.map((c) => (
          <li key={c.id}>
            <span>{c.id}</span>
            <span className="c-dot" data-state={c.status} title={STATE_LABEL[c.status]} aria-label={STATE_LABEL[c.status]} />
          </li>
        ))}
      </ul>
    </Shell>
  );
}
