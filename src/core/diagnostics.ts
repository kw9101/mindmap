export type DiagnosticSeverity = "error" | "warning" | "info";

export type DiagnosticCode =
  | "MM001"
  | "MM002"
  | "MM003"
  | "MM004"
  | "MM005"
  | "MM006"
  | "MM007"
  | "MM008"
  | "MM009"
  | "MM010"
  | "MM011"
  | "MM012"
  | "MM013"
  | "MM014"
  | "MM015"
  | "MM016"
  | "MM017"
  | "MM018"
  | "MM019"
  | "MM020";

export type Diagnostic = {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  line: number;
  column: number;
  help?: string;
};

export function error(
  code: DiagnosticCode,
  message: string,
  line: number,
  column = 1,
  help?: string
): Diagnostic {
  return {
    code,
    severity: "error",
    message,
    line,
    column,
    help
  };
}
