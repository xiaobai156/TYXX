export function scrollAnalysisToTop({
  document: documentObject = globalThis.document,
  window: windowObject = globalThis.window
} = {}) {
  const firstRow = documentObject?.querySelector('.analysis-table tbody tr');
  const fixedHeaderCell = documentObject?.querySelector('.analysis-table thead th');
  if (!firstRow || !fixedHeaderCell || !windowObject) return false;

  const appHeader = documentObject.querySelector('.app-header');
  firstRow.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });

  const rowTop = firstRow.getBoundingClientRect().top;
  const fixedHeaderBottom = fixedHeaderCell.getBoundingClientRect().bottom;
  const appHeaderBottom = appHeader?.getBoundingClientRect().bottom || 0;
  const safeRowTop = Math.max(fixedHeaderBottom, appHeaderBottom) + 8;
  if (rowTop < safeRowTop) {
    windowObject.scrollBy({
      top: rowTop - safeRowTop,
      left: 0,
      behavior: 'auto'
    });
  }
  return true;
}
