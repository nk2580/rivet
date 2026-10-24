export const MIN_GUIDE_WIDTH = 360;
export const MIN_SHEET_WIDTH = 520;
export const MAX_GUIDE_WIDTH = 800;

export function guideWidthBounds(workspaceWidth: number) {
  return {
    min: MIN_GUIDE_WIDTH,
    max: Math.max(MIN_GUIDE_WIDTH, Math.floor(Math.min(MAX_GUIDE_WIDTH, workspaceWidth * .65, workspaceWidth - MIN_SHEET_WIDTH))),
  };
}

export function resolveGuideWidth(requested: number, workspaceWidth: number) {
  const {min, max} = guideWidthBounds(workspaceWidth);
  return {
    width: Math.round(Math.max(min, Math.min(max, requested))),
  };
}

export function readGuideWidth(saved: string | null) {
  const width = Number(saved);
  return saved !== null && Number.isFinite(width) && width >= MIN_GUIDE_WIDTH && width <= MAX_GUIDE_WIDTH ? width : null;
}
