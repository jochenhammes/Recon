import { Fragment, type ReactNode } from "react";
import { t } from "./t";

/**
 * Translated text with markup: `<T k="Klick auf {b}Laden{/b} oder {link}" b={(c) => <b>{c}</b>} link={<a …/>} />`.
 * `{x}…{/x}` wraps the enclosed (translated) text with the render function `x`; `{x}` alone inserts a node or value.
 */
export function T({ k, ...parts }: { k: string } & Record<string, ReactNode | ((children: ReactNode) => ReactNode)>) {
  const text = t(k);
  const out: ReactNode[] = [];
  const re = /\{(\w+)\}([\s\S]*?)\{\/\1\}|\{(\w+)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const name = m[1] ?? m[3];
    const p = parts[name];
    if (m[1] !== undefined) out.push(<Fragment key={i++}>{typeof p === "function" ? p(m[2]) : m[2]}</Fragment>);
    else out.push(<Fragment key={i++}>{typeof p === "function" ? p(null) : (p ?? m[0])}</Fragment>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
