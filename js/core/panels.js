/**
 * panels.js
 * Split a flat row-major grid into rectangular panels for building in
 * physical sections. Ported from mosaic_core.py's split_into_panels.
 */

/**
 * quantizedGrid: flat array of [r,g,b], row-major, length gridW*gridH.
 * Returns a list of panels: { panelRow, panelCol, rowStart, rowEnd,
 * colStart, colEnd, grid } where `grid` is that panel's own flat
 * [r,g,b] array (row-major within the panel, width = colEnd-colStart).
 */
export function splitIntoPanels(quantizedGrid, gridW, gridH, panelW, panelH) {
  panelW = Math.max(1, Math.min(panelW, gridW));
  panelH = Math.max(1, Math.min(panelH, gridH));

  const nPanelCols = Math.ceil(gridW / panelW);
  const nPanelRows = Math.ceil(gridH / panelH);

  const panels = [];
  for (let pr = 0; pr < nPanelRows; pr++) {
    const rowStart = pr * panelH;
    const rowEnd = Math.min(gridH, rowStart + panelH);
    for (let pc = 0; pc < nPanelCols; pc++) {
      const colStart = pc * panelW;
      const colEnd = Math.min(gridW, colStart + panelW);

      const grid = [];
      for (let row = rowStart; row < rowEnd; row++) {
        for (let col = colStart; col < colEnd; col++) {
          grid.push(quantizedGrid[row * gridW + col]);
        }
      }

      panels.push({
        panelRow: pr, panelCol: pc,
        rowStart, rowEnd, colStart, colEnd,
        width: colEnd - colStart, height: rowEnd - rowStart,
        grid,
      });
    }
  }
  return panels;
}
