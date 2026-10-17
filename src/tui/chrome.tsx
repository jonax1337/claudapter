import { Box, Text } from 'ink';
import { safeText } from './editor.js';

// Five-row glyphs keep the wordmark independent of terminal fonts and packages.
const glyphs: Record<string, string[]> = {
  C: ['████', '█   ', '█   ', '█   ', '████'],
  L: ['█   ', '█   ', '█   ', '█   ', '████'],
  A: [' ██ ', '█  █', '████', '█  █', '█  █'],
  U: ['█  █', '█  █', '█  █', '█  █', '████'],
  D: ['███ ', '█  █', '█  █', '█  █', '███ '],
  P: ['███ ', '█  █', '███ ', '█   ', '█   '],
  T: ['████', ' ██ ', ' ██ ', ' ██ ', ' ██ '],
  E: ['████', '█   ', '███ ', '█   ', '████'],
  R: ['███ ', '█  █', '███ ', '█ █ ', '█  █'],
};
const wordmark = Array.from({ length: 5 }, (_, row) =>
  [...'CLAUDAPTER'].map(letter => glyphs[letter][row]).join(' '));

export function Welcome({ width, height, accent }: { width: number; height: number; accent: string }) {
  const large = width >= 53 && height >= 12;
  return <Box width={width} height={height} flexDirection="column" alignItems="center" justifyContent="center" overflow="hidden">
    {large ? wordmark.map((line, index) => <Text key={index} color={accent}>{line}</Text>) :
      <Text bold color={accent}>◈ CLAUDAPTER</Text>}
    <Box marginTop={1}><Text bold>Your workspace. Your models.</Text></Box>
    {height >= 10 && <Text dimColor wrap="truncate-end">Your Claude Code. Your choice of models.</Text>}
    <Box marginTop={1}><Text color={accent}>/model <Text dimColor>choose</Text>   /resume <Text dimColor>continue</Text>   /help <Text dimColor>explore</Text></Text></Box>
  </Box>;
}

export function Composer({ text, accent, border, inactive }: {
  text: string; accent: string; border: string; inactive: boolean;
}) {
  return <Box borderStyle="round" borderColor={inactive ? border : accent} paddingX={1} flexShrink={0}>
    <Text color={inactive ? border : accent}>❯ </Text>
    <Text>{text === '▏' ? <><Text color={accent}>▏</Text><Text dimColor>Ask anything, or type / for commands</Text></> : text}</Text>
  </Box>;
}

export function BrandHeader({ project, version, ready, accent, muted }: {
  project: string; version: string; ready: boolean; accent: string; muted: string;
}) {
  return <Box justifyContent="space-between" flexShrink={0}>
    <Text bold color={accent} wrap="truncate-end">◈ CLAUDAPTER <Text color={muted}> / {safeText(project)}</Text></Text>
    <Text color={muted} wrap="truncate-end">{ready ? 'connected' : 'connecting'} · {version}</Text>
  </Box>;
}
