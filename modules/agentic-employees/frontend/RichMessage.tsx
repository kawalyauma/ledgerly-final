import { Fragment, type ReactNode } from "react";

function inline(value: string): ReactNode[] {
  const parts = String(value || "")
    .split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g)
    .filter(Boolean);

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }

    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }

    return <Fragment key={index}>{part}</Fragment>;
  });
}

function cells(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map(cell => cell.trim());
}

function isTableSeparator(line: string) {
  const parts = cells(line);
  return parts.length > 0 &&
    parts.every(part => /^:?-{3,}:?$/.test(part));
}

function isSpecial(lines: string[], index: number) {
  const line = lines[index]?.trim() || "";
  const next = lines[index + 1]?.trim() || "";

  return (
    /^#{1,6}\s+/.test(line) ||
    /^[-*•]\s+/.test(line) ||
    /^\d+\.\s+/.test(line) ||
    /^-{3,}$/.test(line) ||
    (line.includes("|") && isTableSeparator(next))
  );
}

export function RichMessage({ content }: { content: string }) {
  const lines = String(content || "").replace(/\r/g, "").split("\n");
  const nodes: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const raw = lines[i] || "";
    const line = raw.trim();

    if (!line) {
      i++;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      nodes.push(
        <h3
          key={key++}
          className={`ae-md-heading level-${Math.min(heading[1].length, 4)}`}
        >
          {inline(heading[2])}
        </h3>,
      );
      i++;
      continue;
    }

    if (/^-{3,}$/.test(line)) {
      nodes.push(<hr key={key++}/>);
      i++;
      continue;
    }

    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1] || "")
    ) {
      const headers = cells(line);
      i += 2;

      const rows: string[][] = [];

      while (
        i < lines.length &&
        (lines[i] || "").trim() &&
        (lines[i] || "").includes("|")
      ) {
        rows.push(cells(lines[i] || ""));
        i++;
      }

      nodes.push(
        <div className="ae-rich-table" key={key++}>
          <table>
            <thead>
              <tr>
                {headers.map((header, column) => (
                  <th key={column}>{inline(header)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {headers.map((_, column) => (
                    <td key={column}>{inline(row[column] || "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );

      continue;
    }

    if (/^[-*•]\s+/.test(line)) {
      const items: string[] = [];

      while (
        i < lines.length &&
        /^[-*•]\s+/.test((lines[i] || "").trim())
      ) {
        items.push((lines[i] || "").trim().replace(/^[-*•]\s+/, ""));
        i++;
      }

      nodes.push(
        <ul key={key++}>
          {items.map((item, index) => (
            <li key={index}>{inline(item)}</li>
          ))}
        </ul>,
      );

      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];

      while (
        i < lines.length &&
        /^\d+\.\s+/.test((lines[i] || "").trim())
      ) {
        items.push((lines[i] || "").trim().replace(/^\d+\.\s+/, ""));
        i++;
      }

      nodes.push(
        <ol key={key++}>
          {items.map((item, index) => (
            <li key={index}>{inline(item)}</li>
          ))}
        </ol>,
      );

      continue;
    }

    const paragraph = [line];
    i++;

    while (
      i < lines.length &&
      (lines[i] || "").trim() &&
      !isSpecial(lines, i)
    ) {
      paragraph.push((lines[i] || "").trim());
      i++;
    }

    nodes.push(
      <p key={key++}>{inline(paragraph.join(" "))}</p>,
    );
  }

  return <div className="ae-rich-message">{nodes}</div>;
}
