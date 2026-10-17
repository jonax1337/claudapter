import { safeText } from '../../../dist/tui/editor.js';

export type PermissionKind = 'bash' | 'edit' | 'write' | 'multi-edit' | 'read' | 'search' | 'web' | 'mcp' | 'generic';
export type RowTone = 'title' | 'label' | 'code' | 'added' | 'removed' | 'muted' | 'plain';

export interface DisplayRow {
  tone: RowTone;
  text: string;
  /** Rows with a label render `label  text` with the label muted and column-aligned. */
  label?: string;
}

/** The parts of a pending dialog a permission request is parsed from; `tool` is optional structured data. */
export interface PermissionSource {
  title: string;
  description: string;
  tool?: { name: string; input: Record<string, unknown> };
}

export interface PermissionRequest {
  toolName: string;
  kind: PermissionKind;
  input: Record<string, unknown>;
  /** Free-form lines Claude Code supplied: the intent and the reason the prompt appeared. */
  intent: string[];
  agent?: string;
  blockedPath?: string;
  sessionRules: string[];
}

export const LABEL_WIDTH = 9;
export const PREVIEW_ROWS = 12;
const COLLAPSED_JSON_ROWS = 8;
const PROMPT_PREVIEW_CHARS = 200;
const SESSION_RULES_HEADING = 'Optional session rules:';
const TOOL_IN_TITLE = /^Permission required:\s*(\S+)/;

const KIND_BY_TOOL: Record<string, PermissionKind> = {
  Bash: 'bash', Edit: 'edit', Write: 'write', MultiEdit: 'multi-edit', NotebookEdit: 'edit', Read: 'read', NotebookRead: 'read',
  Glob: 'search', Grep: 'search', WebFetch: 'web', WebSearch: 'web',
};

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const asText = (value: unknown) => (typeof value === 'string' ? safeText(value) : value === undefined ? '' : safeText(JSON.stringify(value)));

function parseRecord(json: string) {
  try { const value = JSON.parse(json); return isRecord(value) ? value : undefined; }
  catch { return undefined; }
}

interface SplitDescription { before: string[]; input?: Record<string, unknown>; after: string[] }

/**
 * The controller appends the pretty-printed tool input to the descriptive lines. The input's own
 * newlines are escaped, so its first `{` line and the next `}` line at column 0 delimit it.
 */
function splitDescription(description: string): SplitDescription {
  const lines = safeText(description).split('\n');
  const start = lines.findIndex(line => line === '{' || line === '{}');
  if (start < 0) return { before: lines, after: [] };
  for (let end = start; end < lines.length; end++) {
    if (lines[end] !== '}' && lines[end] !== '{}') continue;
    const input = parseRecord(lines.slice(start, end + 1).join('\n'));
    if (input) return { before: lines.slice(0, start), input, after: lines.slice(end + 1) };
  }
  return { before: lines, after: [] };
}

function inferToolName(input: Record<string, unknown>): string | undefined {
  if (typeof input.command === 'string') return 'Bash';
  if (Array.isArray(input.edits)) return 'MultiEdit';
  if (typeof input.old_string === 'string') return 'Edit';
  if (typeof input.content === 'string' && typeof input.file_path === 'string') return 'Write';
  if (typeof input.pattern === 'string') return 'output_mode' in input || 'glob' in input ? 'Grep' : 'Glob';
  if (typeof input.url === 'string') return 'WebFetch';
  if (typeof input.query === 'string') return 'WebSearch';
  if (typeof input.file_path === 'string') return 'Read';
  return undefined;
}

function sessionRulesIn(trailer: string[]): string[] {
  const heading = trailer.indexOf(SESSION_RULES_HEADING);
  if (heading < 0) return [];
  try {
    const suggestions = JSON.parse(trailer.slice(heading + 1).join('\n'));
    return (Array.isArray(suggestions) ? suggestions : []).flatMap(suggestion => (Array.isArray(suggestion?.rules) ? suggestion.rules : []))
      .map((rule: any) => (rule?.ruleContent ? `${rule.toolName}(${rule.ruleContent})` : String(rule?.toolName ?? '')))
      .filter(Boolean).map(safeText);
  } catch { return []; }
}

export function parsePermission(source: PermissionSource): PermissionRequest {
  const { before, input: embedded, after } = splitDescription(source.description);
  const input = source.tool?.input ?? embedded ?? {};
  const toolName = source.tool?.name ?? TOOL_IN_TITLE.exec(source.title)?.[1] ?? inferToolName(input) ?? 'Tool';
  const request: PermissionRequest = { toolName, kind: toolName.startsWith('mcp__') ? 'mcp' : KIND_BY_TOOL[toolName] ?? 'generic',
    input, intent: [], sessionRules: sessionRulesIn(after) };
  for (const line of before.filter(Boolean)) {
    if (line.startsWith('Agent: ')) request.agent = line.slice('Agent: '.length);
    else if (line.startsWith('Path: ')) request.blockedPath = line.slice('Path: '.length);
    else request.intent.push(line);
  }
  return request;
}

const labelled = (label: string, text: string): DisplayRow => ({ tone: 'label', label, text });
const muted = (text: string): DisplayRow => ({ tone: 'muted', text });

function collapsedJson(value: unknown, limit: number): DisplayRow[] {
  const lines = safeText(JSON.stringify(value, null, 2) ?? '').split('\n');
  const rows: DisplayRow[] = lines.slice(0, limit).map(text => ({ tone: 'code', text }));
  return lines.length > limit ? [...rows, muted(`… ${lines.length - limit} more lines (? shows the full input)`)] : rows;
}

function previewRows(removed: string, added: string): DisplayRow[] {
  const oldLines = removed ? safeText(removed).split('\n') : [];
  const newLines = added ? safeText(added).split('\n') : [];
  const addedShown = Math.min(newLines.length, Math.max(PREVIEW_ROWS / 2, PREVIEW_ROWS - oldLines.length));
  const removedShown = Math.min(oldLines.length, PREVIEW_ROWS - addedShown);
  const hidden = oldLines.length + newLines.length - removedShown - addedShown;
  return [
    ...oldLines.slice(0, removedShown).map((text): DisplayRow => ({ tone: 'removed', text: '- ' + text })),
    ...newLines.slice(0, addedShown).map((text): DisplayRow => ({ tone: 'added', text: '+ ' + text })),
    ...(hidden > 0 ? [muted(`… ${hidden} more lines`)] : []),
  ];
}

function bashRows({ input }: PermissionRequest): DisplayRow[] {
  const rows: DisplayRow[] = asText(input.command).split('\n').map((text, index) => ({ tone: 'code', text: (index ? '  ' : '$ ') + text }));
  if (typeof input.description === 'string') rows.unshift({ tone: 'plain', text: asText(input.description) });
  if (input.run_in_background === true) rows.push(muted('Runs in the background'));
  if (typeof input.timeout === 'number') rows.push(labelled('Timeout', `${input.timeout} ms`));
  return rows;
}

function editRows({ input }: PermissionRequest): DisplayRow[] {
  return [labelled('File', asText(input.file_path ?? input.notebook_path)),
    ...(input.replace_all === true ? [muted('Replaces every occurrence')] : []),
    ...previewRows(asText(input.old_string), asText(input.new_string))];
}

function writeRows({ input }: PermissionRequest): DisplayRow[] {
  const content = asText(input.content);
  return [labelled('File', asText(input.file_path)), muted(`Writes ${content.split('\n').length} lines`), ...previewRows('', content)];
}

function multiEditRows({ input }: PermissionRequest): DisplayRow[] {
  const edits = Array.isArray(input.edits) ? input.edits.filter(isRecord) : [];
  const first = edits[0];
  return [labelled('File', asText(input.file_path)), labelled('Edits', String(edits.length)),
    ...(first ? previewRows(asText(first.old_string), asText(first.new_string)) : []),
    ...(edits.length > 1 ? [muted(`… ${edits.length - 1} more edits (? shows the full input)`)] : [])];
}

function readRows({ input }: PermissionRequest): DisplayRow[] {
  const range = input.offset !== undefined || input.limit !== undefined ? `from line ${asText(input.offset ?? 1)}, ${asText(input.limit ?? 'all')} lines` : '';
  return [labelled('File', asText(input.file_path ?? input.notebook_path)), ...(range ? [labelled('Range', range)] : [])];
}

function searchRows({ input }: PermissionRequest): DisplayRow[] {
  return [labelled('Pattern', asText(input.pattern)),
    ...(input.path !== undefined ? [labelled('Path', asText(input.path))] : []),
    ...(input.glob !== undefined ? [labelled('Glob', asText(input.glob))] : [])];
}

function webRows({ input }: PermissionRequest): DisplayRow[] {
  const prompt = asText(input.prompt);
  return [...(input.url !== undefined ? [labelled('URL', asText(input.url))] : []),
    ...(input.query !== undefined ? [labelled('Query', asText(input.query))] : []),
    ...(prompt ? [labelled('Prompt', prompt.length > PROMPT_PREVIEW_CHARS ? prompt.slice(0, PROMPT_PREVIEW_CHARS) + '…' : prompt)] : [])];
}

function mcpRows(request: PermissionRequest): DisplayRow[] {
  const [, server = '', ...tool] = request.toolName.split('__');
  return [labelled('Server', server), labelled('Tool', tool.join('__')),
    ...(Object.keys(request.input).length ? [muted('Arguments'), ...collapsedJson(request.input, COLLAPSED_JSON_ROWS)] : [])];
}

const BODY_ROWS: Record<PermissionKind, (request: PermissionRequest) => DisplayRow[]> = {
  bash: bashRows, edit: editRows, write: writeRows, 'multi-edit': multiEditRows, read: readRows, search: searchRows, web: webRows, mcp: mcpRows,
  generic: ({ input }) => collapsedJson(input, PREVIEW_ROWS),
};

const KIND_HEADINGS: Record<PermissionKind, string> = {
  bash: 'Run command', edit: 'Edit file', write: 'Write file', 'multi-edit': 'Edit file', read: 'Read file', search: 'Search files',
  web: 'Access the web', mcp: 'Call MCP tool', generic: 'Use tool',
};

/** The structured, tool-specific view of a permission request as styled rows. */
export function permissionRows(request: PermissionRequest): DisplayRow[] {
  return [
    { tone: 'title', text: `${KIND_HEADINGS[request.kind]}  ·  ${request.toolName}` },
    ...request.intent.map(muted),
    ...BODY_ROWS[request.kind](request),
    ...(request.agent ? [labelled('Agent', request.agent)] : []),
    ...(request.blockedPath ? [labelled('Path', request.blockedPath)] : []),
    ...request.sessionRules.map(rule => labelled('Session', 'allow ' + rule)),
  ];
}
