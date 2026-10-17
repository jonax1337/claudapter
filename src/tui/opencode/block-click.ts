import { useRenderer } from '@opentui/solid';

/** Click handler that ignores the mouse-up ending a text selection, so dragging over a block never triggers it. */
export function useClick(action: () => void): () => void {
  const renderer = useRenderer();
  return () => {
    if (renderer.getSelection()?.getSelectedText()) return;
    action();
  };
}
