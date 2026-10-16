// Modeless statistics prefer their normal corner dock. A short/partly occluded viewport must not squeeze the
// ranking out: float inside the visible viewport when fewer than 128px remain above the corner.
export function combatMetricsLayout({
  cornerTop, cornerBottom, viewportHeight, viewportTop = 0, rem = 40, safeTop = 0, safeBottom = 0,
}) {
  const gap = Math.max(.1 * rem, 8);
  const viewportSpace = Math.max(0, viewportHeight - safeTop - safeBottom - 12);
  const availableHeight = Math.max(0, Math.min(viewportSpace, cornerTop - viewportTop - safeTop - gap));
  return {
    availableHeight,
    viewportSpace,
    viewportPanelTop: viewportTop + safeTop + 6,
    viewportDocked: availableHeight < 128
      || cornerBottom > viewportTop + viewportHeight - safeBottom
      || cornerTop < viewportTop + safeTop + gap,
  };
}
