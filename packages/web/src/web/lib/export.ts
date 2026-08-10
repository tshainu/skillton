/**
 * Report export helpers — CSV download, browser print (which is also the
 * "Save as PDF" path) and clipboard. Kept dependency-free so every report page
 * exports the exact rows it already rendered.
 */

export type CsvValue = string | number | boolean | null | undefined | Date;

function escapeCell(value: CsvValue): string {
  if (value == null) return "";
  const text =
    value instanceof Date ? value.toISOString().slice(0, 19).replace("T", " ") : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: CsvValue[][]): string {
  return [headers.map(escapeCell).join(","), ...rows.map((row) => row.map(escapeCell).join(","))].join(
    "\r\n",
  );
}

export function downloadCsv(fileName: string, headers: string[], rows: CsvValue[][]) {
  /* The BOM keeps Excel from mangling accented characters. */
  const blob = new Blob(["﻿", toCsv(headers, rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Print the element marked `data-print-root`. The print stylesheet hides the
 * chrome, so the browser's own "Save as PDF" produces a clean report.
 */
export function printReport(title?: string) {
  const previous = document.title;
  if (title) document.title = title;
  window.print();
  /* Restore after the print dialog has read the title. */
  window.setTimeout(() => {
    document.title = previous;
  }, 1000);
}

export function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}
