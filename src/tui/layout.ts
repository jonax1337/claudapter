export function shellLayout(width: number, height: number) {
  const headerRows = 2;
  const composerRows = 5;
  const statusAndHintRows = 2;
  const bottomSpace = 1;
  const mainHeight = Math.max(6, height - headerRows - composerRows - statusAndHintRows - bottomSpace);
  const contentHeight = mainHeight - 2;
  return {
    mainHeight,
    contentHeight,
    contentWidth: Math.max(1, width - 6),
    transcriptRows: Math.max(1, contentHeight - 1),
  };
}
