// Structural mirrors of the controller's permission and image records; the UI never imports controller types.
export type PermissionDecision = 'pending' | 'allow-once' | 'allow-session' | 'deny' | 'cancelled';

export interface PermissionRecord {
  decision: PermissionDecision;
  decidedBy?: 'user' | 'engine';
  agentId?: string;
  blockedPath?: string;
  rules?: string[];
}

export interface ImageRef {
  mediaType: string;
  bytes: number;
  width?: number;
  height?: number;
  data?: string;
}

export type PermissionTone = 'pending' | 'allowed' | 'denied' | 'cancelled';

export interface PermissionLine {
  glyph: string;
  tone: PermissionTone;
  headline: string;
  /** Who made the decision, or what the row waits for. */
  by: string;
}

const PERMISSION_LINES: Record<PermissionDecision, Omit<PermissionLine, 'by'>> = {
  pending: { glyph: '?', tone: 'pending', headline: 'Permission requested' },
  'allow-once': { glyph: '✓', tone: 'allowed', headline: 'Allowed once' },
  'allow-session': { glyph: '✓', tone: 'allowed', headline: 'Allowed for this session' },
  deny: { glyph: '✗', tone: 'denied', headline: 'Denied' },
  cancelled: { glyph: '∅', tone: 'cancelled', headline: 'Request ended' },
};

function decidedBy(record: PermissionRecord): string {
  if (record.decision === 'pending') return 'waiting for your decision';
  if (record.decision === 'cancelled') return 'ended before a decision';
  return record.decidedBy === 'engine' ? 'by Claude Code' : 'by you';
}

export function permissionLine(record: PermissionRecord): PermissionLine {
  return { ...PERMISSION_LINES[record.decision], by: decidedBy(record) };
}

/** Context lines under a permission row: the requesting agent, the blocked path and the session rules that were granted. */
export function permissionDetails(record: PermissionRecord): string[] {
  return [
    ...(record.agentId ? [`agent ${record.agentId}`] : []),
    ...(record.blockedPath ? [`path ${record.blockedPath}`] : []),
    ...(record.decision === 'allow-session' && record.rules?.length ? [`rules ${record.rules.join(', ')}`] : []),
  ];
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** `image/png · 1200×800 · 120.0 KB`: what a placeholder shows for an image the terminal cannot display. */
export function imageLabel(image: ImageRef): string {
  const size = image.width && image.height ? `${image.width}×${image.height}` : undefined;
  return [image.mediaType, size, formatBytes(image.bytes)].filter(Boolean).join(' · ');
}
