export const SANDBOX_LIMITS = {
  maxCodeChars: 4_000,
  maxInputBytes: 120_000,
  maxInputs: 3,
  maxRows: 20_000,
  maxColumns: 50,
  maxCells: 200_000,
  maxOutputChars: 16_000,
  maxSteps: 30_000,
  maxExecutionMs: 1_000,
} as const;

export type SandboxInputFile = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  content: string;
};

export type SandboxOperation =
  | "calculate"
  | "count"
  | "sum"
  | "average"
  | "filter"
  | "select";

export type SandboxProgram = {
  version: 1;
  operation: SandboxOperation;
  expression?: string;
  field?: string;
  equals?: string | number | boolean | null;
  fields?: string[];
};

export type SandboxRunStatus =
  | "completed"
  | "cancelled"
  | "timed-out"
  | "failed";

export type SandboxResourceUsage = {
  elapsedMs: number;
  steps: number;
  inputBytes: number;
  outputBytes: number;
  limits: {
    maxExecutionMs: number;
    maxSteps: number;
    maxOutputChars: number;
  };
};

export type SandboxExecutionResult = {
  status: SandboxRunStatus;
  summary: string;
  output: string;
  stdout: string;
  stderr: string;
  resourceUsage: SandboxResourceUsage;
  generatedFiles: [];
};

type Row = Record<string, unknown>;

export class SandboxError extends Error {
  constructor(message: string, public readonly kind: "invalid" | "limit" | "runtime" = "invalid") {
    super(message);
    this.name = "SandboxError";
  }
}

function utf8Length(value: string) {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function cleanText(value: string, maximum: number) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximum);
}

export function redactSandboxText(value: string) {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]")
    .replace(/(?:\+[\d ()-]{8,}\d|\d[\d ()-]*[- ()][\d ()-]{6,}\d)/g, "[redacted phone]")
    .replace(
      /\b(?:sk|pk|api|token|secret)[_-]?[a-z0-9_-]{8,}\b/gi,
      "[redacted secret]",
    );
}

function fail(message: string, kind: SandboxError["kind"] = "invalid"): never {
  throw new SandboxError(message, kind);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function assertSafeKey(value: unknown, label: string) {
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_.-]{0,80}$/.test(value)) {
    fail(`${label} must be a simple field name.`);
  }
  return value;
}

function parseProgram(source: string): SandboxProgram {
  if (source.length > SANDBOX_LIMITS.maxCodeChars) {
    fail(`Code is limited to ${SANDBOX_LIMITS.maxCodeChars.toLocaleString()} characters.`, "limit");
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    fail("Use the sandbox JSON format shown below; JavaScript and shell commands are not supported.");
  }
  if (!isRecord(value) || value.version !== 1 || typeof value.operation !== "string") {
    fail("Sandbox code must contain version 1 and one supported operation.");
  }
  const allowed = new Set(["version", "operation", "expression", "field", "equals", "fields"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    fail("Only version, operation, expression, field, equals, and fields are allowed.");
  }
  const operations: SandboxOperation[] = [
    "calculate",
    "count",
    "sum",
    "average",
    "filter",
    "select",
  ];
  if (!operations.includes(value.operation as SandboxOperation)) {
    fail("That operation is not available in the sandbox.");
  }
  const operation = value.operation as SandboxOperation;
  const program: SandboxProgram = { version: 1, operation };
  if (operation === "calculate") {
    if (typeof value.expression !== "string" || !value.expression.trim()) {
      fail("calculate requires a numeric expression.");
    }
    program.expression = value.expression.trim().slice(0, 500);
  } else if (operation === "sum" || operation === "average") {
    program.field = assertSafeKey(value.field, "field");
  } else if (operation === "filter") {
    program.field = assertSafeKey(value.field, "field");
    if (
      !(
        value.equals === null ||
        typeof value.equals === "string" ||
        typeof value.equals === "number" ||
        typeof value.equals === "boolean"
      )
    ) {
      fail("filter equals must be text, a number, true, false, or null.");
    }
    program.equals = value.equals;
  } else if (operation === "select") {
    if (
      !Array.isArray(value.fields) ||
      value.fields.length < 1 ||
      value.fields.length > SANDBOX_LIMITS.maxColumns
    ) {
      fail(`select requires 1–${SANDBOX_LIMITS.maxColumns} fields.`);
    }
    program.fields = value.fields.map((field) => assertSafeKey(field, "field"));
  }
  return program;
}

function parseCsv(content: string): Row[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === '"') {
      if (quoted && content[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && content[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((item) => item.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) fail("The CSV input has an unterminated quoted cell.");
  row.push(cell);
  if (row.some((item) => item.trim())) rows.push(row);
  if (rows.length < 2) fail("CSV input needs a header row and at least one data row.");
  const headers = rows[0].map((header) => cleanText(header, 80));
  if (
    headers.some((header) => !header) ||
    new Set(headers).size !== headers.length ||
    headers.length > SANDBOX_LIMITS.maxColumns
  ) {
    fail("CSV headers must be non-empty, unique, and within the column limit.");
  }
  return rows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );
}

function parseInput(input: SandboxInputFile): Row[] {
  if (!input.id || !input.name || typeof input.content !== "string") {
    fail("An input file is missing its explicit identity or content.");
  }
  const byteLength = utf8Length(input.content);
  if (byteLength > SANDBOX_LIMITS.maxInputBytes) {
    fail(`${input.name} is larger than the ${SANDBOX_LIMITS.maxInputBytes.toLocaleString()} byte sandbox input limit.`, "limit");
  }
  const lowerMime = input.mimeType.toLowerCase();
  if (lowerMime.includes("csv") || /\.csv$/i.test(input.name)) {
    return parseCsv(input.content);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.content);
  } catch {
    fail("Choose a CSV or JSON file for row operations.");
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.rows)
      ? parsed.rows
      : null;
  if (!rows || rows.some((row) => !isRecord(row))) {
    fail("JSON row input must be an array of objects or an object with a rows array.");
  }
  return rows as Row[];
}

function valueAt(row: Row, field: string) {
  return field.split(".").reduce<unknown>((current, part) => {
    return isRecord(current) ? current[part] : undefined;
  }, row);
}

function numericValue(value: unknown, field: string) {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(number)) fail(`Field "${field}" contains a non-numeric value.`);
  return number;
}

type ArithmeticToken = { kind: "number" | "operator" | "paren"; value: string };

function evaluateArithmetic(expression: string, steps: { value: number }) {
  if (expression.length > 500 || /[^0-9+\-*/%().\s]/.test(expression)) {
    fail("calculate accepts only numbers, parentheses, decimal points, and + - * / %.");
  }
  const tokens: ArithmeticToken[] = [];
  const matcher = /\d+(?:\.\d+)?|[+\-*/%()]|\s+/g;
  let consumed = 0;
  for (const match of expression.matchAll(matcher)) {
    if (match.index !== consumed) fail("The calculation contains an unsupported token.");
    consumed += match[0].length;
    if (!/^\s+$/.test(match[0])) {
      tokens.push({
        kind: /^[0-9]/.test(match[0]) ? "number" : match[0] === "(" || match[0] === ")" ? "paren" : "operator",
        value: match[0],
      });
    }
  }
  if (consumed !== expression.length || tokens.length === 0) fail("Enter a non-empty calculation.");
  let position = 0;
  function primary(): number {
    steps.value += 1;
    if (steps.value > SANDBOX_LIMITS.maxSteps) fail("The sandbox step limit was reached.", "limit");
    const token = tokens[position];
    if (!token) fail("The calculation is incomplete.");
    if (token.value === "-") {
      position += 1;
      return -primary();
    }
    if (token.value === "(") {
      position += 1;
      const result = additive();
      if (tokens[position]?.value !== ")") fail("The calculation has unbalanced parentheses.");
      position += 1;
      return result;
    }
    if (token.kind !== "number") fail("Expected a number.");
    position += 1;
    return Number(token.value);
  }
  function multiplicative(): number {
    let result = primary();
    while (["*", "/", "%"].includes(tokens[position]?.value ?? "")) {
      const operator = tokens[position].value;
      position += 1;
      const right = primary();
      if ((operator === "/" || operator === "%") && right === 0) fail("Division by zero is not allowed.");
      result = operator === "*" ? result * right : operator === "/" ? result / right : result % right;
    }
    return result;
  }
  function additive(): number {
    let result = multiplicative();
    while (["+", "-"].includes(tokens[position]?.value ?? "")) {
      const operator = tokens[position].value;
      position += 1;
      const right = multiplicative();
      result = operator === "+" ? result + right : result - right;
    }
    return result;
  }
  const result = additive();
  if (position !== tokens.length || !Number.isFinite(result)) fail("The calculation did not produce a finite number.");
  return result;
}

function enforceCollectionLimits(rows: Row[]) {
  if (rows.length > SANDBOX_LIMITS.maxRows) {
    fail(`The input has more than ${SANDBOX_LIMITS.maxRows.toLocaleString()} rows.`, "limit");
  }
  const columns = new Set(rows.flatMap((row) => Object.keys(row)));
  if (columns.size > SANDBOX_LIMITS.maxColumns || rows.length * Math.max(1, columns.size) > SANDBOX_LIMITS.maxCells) {
    fail("The input exceeds the sandbox row, column, or cell limit.", "limit");
  }
}

function stringifyOutput(value: unknown) {
  const output = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (output.length > SANDBOX_LIMITS.maxOutputChars) {
    fail(`The result is larger than the ${SANDBOX_LIMITS.maxOutputChars.toLocaleString()} character output limit.`, "limit");
  }
  return redactSandboxText(output);
}

function makeResult(
  status: SandboxRunStatus,
  summary: string,
  output: string,
  stderr: string,
  startedAt: number,
  steps: number,
  inputBytes: number,
): SandboxExecutionResult {
  const safeOutput = output.slice(0, SANDBOX_LIMITS.maxOutputChars);
  return {
    status,
    summary,
    output: safeOutput,
    stdout: "",
    stderr: redactSandboxText(stderr).slice(0, 2_000),
    resourceUsage: {
      elapsedMs: Math.max(0, Date.now() - startedAt),
      steps,
      inputBytes,
      outputBytes: utf8Length(safeOutput),
      limits: {
        maxExecutionMs: SANDBOX_LIMITS.maxExecutionMs,
        maxSteps: SANDBOX_LIMITS.maxSteps,
        maxOutputChars: SANDBOX_LIMITS.maxOutputChars,
      },
    },
    generatedFiles: [],
  };
}

export async function executeSandboxCode(options: {
  source: string;
  inputs: SandboxInputFile[];
  isCancelled?: () => boolean;
}): Promise<SandboxExecutionResult> {
  const startedAt = Date.now();
  let steps = 0;
  const inputBytes = options.inputs.reduce((sum, input) => sum + utf8Length(input.content), 0);
  try {
    if (options.inputs.length > SANDBOX_LIMITS.maxInputs) {
      fail(`Choose no more than ${SANDBOX_LIMITS.maxInputs} input files.`, "limit");
    }
    if (options.isCancelled?.()) {
      return makeResult("cancelled", "Run cancelled before execution started.", "", "", startedAt, steps, inputBytes);
    }
    const program = parseProgram(options.source);
    if (Date.now() - startedAt > SANDBOX_LIMITS.maxExecutionMs) {
      return makeResult("timed-out", "The sandbox time limit was reached before execution.", "", "", startedAt, steps, inputBytes);
    }
    let output: unknown;
    if (program.operation === "calculate") {
      output = { result: evaluateArithmetic(program.expression ?? "", { value: steps }) };
      steps += 1;
    } else {
      if (options.inputs.length === 0) fail("Select an explicit CSV or JSON input file.");
      const rows = parseInput(options.inputs[0]);
      enforceCollectionLimits(rows);
      steps += rows.length;
      if (steps > SANDBOX_LIMITS.maxSteps) fail("The sandbox step limit was reached.", "limit");
      if (options.isCancelled?.()) {
        return makeResult("cancelled", "Run cancelled before the result was produced.", "", "", startedAt, steps, inputBytes);
      }
      if (program.operation === "count") output = { count: rows.length };
      if (program.operation === "sum" || program.operation === "average") {
        const total = rows.reduce((sum, row) => sum + numericValue(valueAt(row, program.field ?? ""), program.field ?? ""), 0);
        output = program.operation === "sum"
          ? { field: program.field, sum: total }
          : { field: program.field, average: rows.length ? total / rows.length : null, count: rows.length };
      }
      if (program.operation === "filter") {
        output = rows.filter((row) => valueAt(row, program.field ?? "") === program.equals);
      }
      if (program.operation === "select") {
        output = rows.map((row) => Object.fromEntries(
          (program.fields ?? []).map((field) => [field, valueAt(row, field)]),
        ));
      }
    }
    if (Date.now() - startedAt > SANDBOX_LIMITS.maxExecutionMs) {
      return makeResult("timed-out", "The sandbox time limit was reached before the result was returned.", "", "", startedAt, steps, inputBytes);
    }
    const rendered = stringifyOutput(output);
    return makeResult("completed", "Completed locally in the pure-operation sandbox. No files were written and no network or device service was used.", rendered, "", startedAt, steps, inputBytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The sandbox run failed safely.";
    const kind = error instanceof SandboxError ? error.kind : "runtime";
    const status: SandboxRunStatus = options.isCancelled?.() ? "cancelled" : kind === "limit" && Date.now() - startedAt > SANDBOX_LIMITS.maxExecutionMs ? "timed-out" : "failed";
    return makeResult(status, status === "cancelled" ? "Run cancelled before it could complete." : "The sandbox rejected or could not complete this run. No files were written.", "", message, startedAt, steps, inputBytes);
  }
}

export function formatSandboxProgramExamples() {
  return [
    '{"version":1,"operation":"count"}',
    '{"version":1,"operation":"sum","field":"amount"}',
    '{"version":1,"operation":"filter","field":"status","equals":"open"}',
    '{"version":1,"operation":"select","fields":["name","amount"]}',
    '{"version":1,"operation":"calculate","expression":"(12 + 8) * 3"}',
  ].join("\n");
}