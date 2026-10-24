import {describe, expect, it} from 'vitest';
import {guideWidthBounds, readGuideWidth, resolveGuideWidth} from '../src/app/guide-layout';

describe('guide split safety', () => {
  it('keeps both panels usable as the workspace narrows and caps wide chat panels', () => {
    for (const workspace of [1096, 1244, 1394, 1800, 2400]) {
      const {min, max} = guideWidthBounds(workspace);
      expect(min).toBeGreaterThanOrEqual(360);
      expect(workspace - max).toBeGreaterThanOrEqual(520);
      expect(max).toBeLessThanOrEqual(800);
      expect(max).toBeLessThanOrEqual(workspace * .65);
      expect(resolveGuideWidth(800, workspace).width).toBe(max);
    }
  });
  it('clamps drags at both limits even when dragged far beyond the maximum', () => {
    expect(resolveGuideWidth(-100, 1096)).toEqual({width: 360});
    const {max} = guideWidthBounds(1096);
    for(const requested of [max,max+32,max+33,10000,Number.MAX_SAFE_INTEGER]){
      expect(resolveGuideWidth(requested,1096)).toEqual({width:max});
    }
  });
  it('ignores invalid saved widths and retains a valid preference for future window sizes', () => {
    for (const saved of [null, '', 'NaN', 'Infinity', '-10', '2000', '200']) expect(readGuideWidth(saved)).toBeNull();
    const preferred = readGuideWidth('720')!;
    expect(resolveGuideWidth(preferred, 1096).width).toBe(576);
    expect(resolveGuideWidth(preferred, 1800).width).toBe(720);
  });
});
