import type { Query } from '@anthropic-ai/claude-agent-sdk';
import { invokeCompat, SIDE_QUESTION_MAX_LENGTH } from './compat.js';
import { safeText } from './editor.js';

export const SIDE_QUESTION_COMMAND = '/btw';

export interface SideAnswer {
  text: string;
  /** The engine produced this text itself (for example a refusal notice) instead of the model. */
  synthetic: boolean;
  /** Model that answered after a refusal fallback; absent when the requested model answered. */
  fallbackModel?: string;
}

/** The question text of `/btw <question>`, or undefined when the input is another prompt. */
export function sideQuestionOf(input: string): string | undefined {
  const match = /^\/btw(?:\s+([\s\S]*))?$/.exec(input.trim());
  return match ? match[1]?.trim() ?? '' : undefined;
}

export function requireSideQuestion(text: string): string {
  if (!text.trim()) throw new Error('Ask a question after /btw, for example: /btw what does this flag do?');
  if (text.length > SIDE_QUESTION_MAX_LENGTH) throw new Error(`A side question is limited to ${SIDE_QUESTION_MAX_LENGTH} characters.`);
  return text.trim();
}

/**
 * Asks the engine a question about the running conversation without queuing a turn:
 * the main turn, its tools and the saved conversation are not touched.
 * The engine bills this like any other request to the active model.
 */
export async function askSideQuestion(query: Query, question: string, signal?: AbortSignal): Promise<SideAnswer | undefined> {
  const result = await invokeCompat(query, 'askSideQuestion', { question: requireSideQuestion(question), signal, confirmed: true });
  if (result === null || result === undefined) return undefined;
  return {
    text: safeText(result.response).trim(),
    synthetic: result.synthetic,
    fallbackModel: typeof result.refusalFallback?.fallbackModel === 'string' ? safeText(result.refusalFallback.fallbackModel) : undefined,
  };
}
