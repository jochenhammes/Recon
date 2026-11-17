/** Quotes a CSV text field (semicolon-separated files). */
export const csvText = (s: string) => `"${s.replace(/"/g, "'")}"`;

/**
 * Table first (header row = line 1), then a blank line and the information rows as "key;value": spreadsheet
 * programs (Excel, Numbers) detect the semicolon separator from the first lines, so no comment lines on top.
 */
export function csvWithInfo(table: string[], info: [string, string][]): string {
  return [...table, "", ...info.map(([k, v]) => `${csvText(k)};${csvText(v)}`)].join("\n") + "\n";
}
