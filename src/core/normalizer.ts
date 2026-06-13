import type { Diagnostic } from "./diagnostics";
import { parseMindmap } from "./parser";
import { serializeMindmap } from "./serializer";

export type NormalizeMindmapSourceResult =
  | { ok: true; source: string; changed: boolean }
  | { ok: false; diagnostics: Diagnostic[]; diagnosticSource: string };

export function normalizeMindmapSource(source: string): NormalizeMindmapSourceResult {
  const repairedSource = repairFileShape(source);
  const result = parseMindmap(repairedSource);
  if (!result.ok) {
    return {
      ok: false,
      diagnostics: result.diagnostics,
      diagnosticSource: repairedSource
    };
  }

  const normalizedSource = serializeMindmap(result.mindmap);
  return {
    ok: true,
    source: normalizedSource,
    changed: normalizedSource !== source
  };
}

function repairFileShape(source: string): string {
  const lfSource = source.replace(/\r\n?/g, "\n");
  const withoutFinalBlankRun = lfSource.replace(/\n*$/, "");
  const lines = withoutFinalBlankRun.split("\n").map(normalizeLineShape);
  return `${lines.join("\n")}\n`;
}

function normalizeLineShape(line: string): string {
  if (isExplicitEmptyListItem(line)) {
    return line.trimEnd();
  }

  return isPotentialListLine(line) ? line : line.trimEnd();
}

function isExplicitEmptyListItem(line: string): boolean {
  return /^[ ]*- $/.test(line);
}

function isPotentialListLine(line: string): boolean {
  return /^[ \t]*([-+*]|\d+[.)])( .*)?$/.test(line);
}
