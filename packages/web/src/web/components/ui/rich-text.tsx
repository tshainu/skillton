import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { scoreColor } from "./score";

/**
 * Compact markdown renderer for AI output.
 *
 * The copilot answers in markdown — headings, bullets, numbered steps, tables
 * and bold call-outs. Rendering that as plain pre-wrapped text made long answers
 * hard to scan, so this turns the common subset into styled blocks, and
 * highlights inline scores like "82/100" so numbers pop.
 */

/** Inline: **bold**, *italic*, `code`, and score highlighting. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\b\d{1,3}(?:\.\d)?\s*\/\s*100\b|\b\d{1,3}(?:\.\d)?%)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;

    if (token.startsWith("**")) {
      nodes.push(
        <strong key={key} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="num rounded bg-white/[0.07] px-1 py-0.5 text-[12px] text-primary-light">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("*")) {
      nodes.push(
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    } else {
      /* A score or percentage — colour it by band. */
      const value = Number.parseFloat(token);
      nodes.push(
        <span
          key={key}
          className="num mx-0.5 rounded px-1.5 py-0.5 text-[12.5px] font-semibold"
          style={{
            color: scoreColor(value),
            background: `${scoreColor(value)}1a`,
            border: `1px solid ${scoreColor(value)}3a`,
          }}
        >
          {token}
        </span>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

interface Block {
  kind: "h" | "p" | "ul" | "ol" | "quote" | "table" | "code";
  level?: number;
  lines: string[];
}

function parse(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.replace(/\r/g, "").split("\n");
  let current: Block | null = null;

  const push = () => {
    if (current) blocks.push(current);
    current = null;
  };

  let inCode = false;
  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.trim().startsWith("```")) {
      if (inCode) push();
      else {
        push();
        current = { kind: "code", lines: [] };
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      current?.lines.push(raw);
      continue;
    }

    if (!line.trim()) {
      push();
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      push();
      blocks.push({ kind: "h", level: heading[1]!.length, lines: [heading[2]!] });
      continue;
    }

    if (/^\s*[-*•]\s+/.test(line)) {
      if (current?.kind !== "ul") {
        push();
        current = { kind: "ul", lines: [] };
      }
      current.lines.push(line.replace(/^\s*[-*•]\s+/, ""));
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      if (current?.kind !== "ol") {
        push();
        current = { kind: "ol", lines: [] };
      }
      current.lines.push(line.replace(/^\s*\d+[.)]\s+/, ""));
      continue;
    }

    if (line.trim().startsWith(">")) {
      if (current?.kind !== "quote") {
        push();
        current = { kind: "quote", lines: [] };
      }
      current.lines.push(line.replace(/^\s*>\s?/, ""));
      continue;
    }

    if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      if (current?.kind !== "table") {
        push();
        current = { kind: "table", lines: [] };
      }
      current.lines.push(line.trim());
      continue;
    }

    if (current?.kind !== "p") {
      push();
      current = { kind: "p", lines: [] };
    }
    current.lines.push(line);
  }
  push();
  return blocks;
}

function cells(row: string) {
  return row
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
}

export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = parse(text);

  return (
    <div className={cn("space-y-3 text-[13.5px] leading-relaxed", className)}>
      {blocks.map((block, i) => {
        const key = `b${i}`;

        if (block.kind === "h") {
          const size =
            block.level === 1
              ? "text-[16px]"
              : block.level === 2
                ? "text-[15px]"
                : "text-[13.5px]";
          return (
            <p key={key} className={cn("font-display font-semibold tracking-tight", size)}>
              {inline(block.lines[0] ?? "", key)}
            </p>
          );
        }

        if (block.kind === "ul") {
          return (
            <ul key={key} className="space-y-1.5">
              {block.lines.map((line, j) => (
                <li key={j} className="flex gap-2.5">
                  <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-primary" />
                  <span className="min-w-0 flex-1">{inline(line, `${key}-${j}`)}</span>
                </li>
              ))}
            </ul>
          );
        }

        if (block.kind === "ol") {
          return (
            <ol key={key} className="space-y-1.5">
              {block.lines.map((line, j) => (
                <li key={j} className="flex gap-2.5">
                  <span className="num mt-px grid size-5 shrink-0 place-items-center rounded-md border border-primary/30 bg-primary/10 text-[11px] font-semibold text-primary-light">
                    {j + 1}
                  </span>
                  <span className="min-w-0 flex-1">{inline(line, `${key}-${j}`)}</span>
                </li>
              ))}
            </ol>
          );
        }

        if (block.kind === "quote") {
          return (
            <blockquote
              key={key}
              className="rounded-r-lg border-l-2 border-primary/50 bg-primary/[0.06] px-3 py-2 text-[13px] text-foreground/85"
            >
              {inline(block.lines.join(" "), key)}
            </blockquote>
          );
        }

        if (block.kind === "code") {
          return (
            <pre
              key={key}
              className="num overflow-x-auto rounded-lg border border-border bg-black/40 p-3 text-[12px] leading-relaxed"
            >
              {block.lines.join("\n")}
            </pre>
          );
        }

        if (block.kind === "table") {
          const rows = block.lines.filter((line) => !/^\|[\s:|-]+\|$/.test(line));
          const [head, ...body] = rows;
          if (!head) return null;
          return (
            <div key={key} className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-left text-[12.5px]">
                <thead>
                  <tr>
                    {cells(head).map((cell, j) => (
                      <th
                        key={j}
                        className="border-b border-border bg-white/[0.03] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                      >
                        {cell}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.map((row, j) => (
                    <tr key={j} className="transition-colors hover:bg-white/[0.025]">
                      {cells(row).map((cell, k) => (
                        <td key={k} className="border-b border-border/60 px-3 py-2 align-middle">
                          {inline(cell, `${key}-${j}-${k}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        return (
          <p key={key} className="text-foreground/90">
            {inline(block.lines.join(" "), key)}
          </p>
        );
      })}
    </div>
  );
}
