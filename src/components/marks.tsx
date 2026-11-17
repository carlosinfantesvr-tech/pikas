"use client";

import { aiMark, assetMark } from "@/lib/marks";

function Fallback({ initials, hue, label }: { initials: string; hue: number; label: string }) {
  return (
    <span className="mark-fallback" style={{ background: `hsl(${hue} 55% 38%)` }} role="img" aria-label={label} title={label}>
      {initials}
    </span>
  );
}

function Mark({ spec, labelled }: { spec: ReturnType<typeof assetMark>; labelled?: boolean }) {
  return (
    <span className="brand-lockup">
      {spec.src && spec.mono ? (
        <span className="brand-mark mono" style={{ maskImage: `url(${spec.src})`, WebkitMaskImage: `url(${spec.src})` }} role="img" aria-label={labelled ? undefined : spec.label} title={spec.label} />
      ) : null}
      {spec.src && !spec.mono ? <img className="brand-mark" src={spec.src} alt={labelled ? "" : spec.label} width={22} height={22} /> : null}
      {!spec.src ? <Fallback initials={spec.initials} hue={spec.hue} label={spec.label} /> : null}
      {labelled ? <span>{spec.label}</span> : null}
    </span>
  );
}

export function AssetMark({ symbol, labelled = false }: { symbol: string; labelled?: boolean }) {
  return <Mark spec={assetMark(symbol)} labelled={labelled} />;
}

export function AiMark({ id, labelled = false }: { id: string; labelled?: boolean }) {
  return <Mark spec={aiMark(id)} labelled={labelled} />;
}
