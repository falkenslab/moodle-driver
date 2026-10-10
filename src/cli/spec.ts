// The shape of the command table the `moodle` command is built from (ADR-012): one command per method
// of the Moodle object, generated from its types by scripts/generate-cli-commands.mjs.

/** How a value typed on the command line becomes the argument the method takes. */
export type ValueKind =
  | { kind: "number" }
  | { kind: "string" }
  | { kind: "boolean" }
  | { kind: "date" }
  | { kind: "enum"; values: string[] }
  | { kind: "numbers" }
  | { kind: "strings" }
  | { kind: "json" };

export interface ParamSpec {
  name: string;
  optional: boolean;
  /** The TypeScript type, as the API reference shows it. */
  type: string;
  value: ValueKind;
  description?: string;
}

export interface CommandSpec {
  /** The method's name: the command, also typed in kebab-case. */
  name: string;
  description: string;
  /** The positional arguments, in order. */
  params: ParamSpec[];
  /** The last parameter, when it's an options object: its fields are `--flags`, or `--json` gives it whole. */
  options?: {
    name: string;
    optional: boolean;
    /** Takes any field (a service's arguments): unknown flags are passed as they come. */
    open: boolean;
    fields: ParamSpec[];
  };
}
