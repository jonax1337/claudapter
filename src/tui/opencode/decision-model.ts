export interface DecisionField {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  secret?: boolean;
  options?: string[];
  multi?: boolean;
  /** Prefills the answer; multi fields take the comma-separated selection. */
  initial?: string;
}

export interface DecisionChoice {
  label: string;
  value: unknown;
}

export const NO_FIELD = -1;
const ANSWER_SEPARATOR = ', ';

export const hasOptions = (field: DecisionField) => !field.secret && (field.options?.length ?? 0) > 0;

/** A tool permission prompt: no form fields and exactly the allow/deny answers Claudapter's controller offers. */
export function isPermissionDecision(decision: { fields: DecisionField[]; choices: DecisionChoice[] }) {
  const values = decision.choices.map(choice => choice.value);
  return decision.fields.length === 0 && values.includes('allow') && values.includes('deny');
}

export type PermissionShortcut = 'allow' | 'deny' | 'session';

/** Maps a key to the answer it stands for, if the dialog offers it. `y` and `s` need the dialog to be armed. */
export function permissionShortcut(key: string, choices: DecisionChoice[], armed: boolean): number | undefined {
  const answer: PermissionShortcut | undefined = ({ y: 'allow', n: 'deny', s: 'session' } as const)[key as 'y' | 'n' | 's'];
  if (!answer || (answer !== 'deny' && !armed)) return undefined;
  const index = choices.findIndex(choice => choice.value === answer);
  return index < 0 ? undefined : index;
}

/** `1`..`9` select an option; returns the zero-based option row or undefined. */
export function numberKeyRow(key: string, rows: number): number | undefined {
  if (!/^[1-9]$/.test(key)) return undefined;
  const row = Number(key) - 1;
  return row < rows ? row : undefined;
}

/** Tab order: buttons, then each field, then back to the buttons. */
export function nextField(current: number, count: number, backwards: boolean) {
  const step = backwards ? current - 1 : current + 1;
  if (step < NO_FIELD) return count - 1;
  return step >= count ? NO_FIELD : step;
}

export function firstMissingField(fields: DecisionField[], values: Record<string, string>) {
  return fields.findIndex(field => field.required && !values[field.key]?.trim());
}

/** Answers that submit a form (as opposed to cancel it) have to satisfy the required fields. */
export const submitsForm = (value: unknown) => value === 'submit' || value === true;

function tokens(value: string, multi: boolean) {
  return (multi ? value.split(',') : [value]).map(part => part.trim()).filter(Boolean);
}

/** Option answers are plain strings: one label, or comma-separated labels for multi-select. */
export function chosenOptions(value: string, options: string[], multi: boolean) {
  return options.filter(option => tokens(value, multi).includes(option));
}

export function customAnswer(value: string, options: string[], multi: boolean) {
  return tokens(value, multi).filter(token => !options.includes(token)).join(ANSWER_SEPARATOR);
}

export function toggleOption(value: string, option: string, options: string[], multi: boolean) {
  if (!multi) return option;
  const chosen = chosenOptions(value, options, true);
  const next = chosen.includes(option) ? chosen.filter(item => item !== option) : options.filter(item => item === option || chosen.includes(item));
  return [...next, customAnswer(value, options, true)].filter(Boolean).join(ANSWER_SEPARATOR);
}

export function withCustomAnswer(value: string, custom: string, options: string[], multi: boolean) {
  return multi ? [...chosenOptions(value, options, true), custom].filter(Boolean).join(ANSWER_SEPARATOR) : custom;
}

/** Rows shown for an option question: its options plus the free-text row. */
export const optionRows = (field: DecisionField) => (field.options?.length ?? 0) + 1;

export function moveRow(row: number, step: -1 | 1, rows: number) {
  return Math.max(0, Math.min(rows - 1, row + step));
}
