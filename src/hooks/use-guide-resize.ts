import {useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes} from 'react';
import {guideWidthBounds, readGuideWidth, resolveGuideWidth} from '@/app/guide-layout';

const storageKey = 'rivet:guide-width';
type Drag = {pointerId: number; element: HTMLDivElement; x: number; width: number; lastWidth: number};

export function useGuideResize(enabled: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [preferred, setPreferred] = useState(() => readGuideWidth(localStorage.getItem(storageKey)));
  const [draft, setDraft] = useState<number | null>(null);
  const [layout, setLayout] = useState({width: 1200, defaultWidth: window.innerWidth >= 1600 ? 560 : 480, split: window.innerWidth >= 1320});
  const bounds = guideWidthBounds(layout.width);
  const width = resolveGuideWidth(draft ?? preferred ?? layout.defaultWidth, layout.width).width;

  function finish(commit: boolean) {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    delete document.documentElement.dataset.guideResizing;
    if (current.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
    if (commit) setPreferred(current.lastWidth);
    setDraft(null);
  }

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const next = {width: container.getBoundingClientRect().width, defaultWidth: window.innerWidth >= 1600 ? 560 : 480, split: window.innerWidth >= 1320};
      setLayout(previous => previous.width === next.width && previous.defaultWidth === next.defaultWidth && previous.split === next.split ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    window.addEventListener('resize', measure);
    measure();
    return () => {observer.disconnect(); window.removeEventListener('resize', measure);};
  }, []);

  useEffect(() => {
    if (preferred !== null) localStorage.setItem(storageKey, String(preferred));
  }, [preferred]);
  useEffect(() => {if (!enabled || !layout.split) finish(false);}, [enabled, layout.split, layout.width]);
  useEffect(() => {
    const cancel = () => finish(false);
    const escape = (event: KeyboardEvent) => {if (event.key === 'Escape' && drag.current) {event.preventDefault(); cancel();}};
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', escape);
    return () => {cancel(); window.removeEventListener('blur', cancel); window.removeEventListener('keydown', escape);};
  }, []);

  const separatorProps: HTMLAttributes<HTMLDivElement> = {
    role: 'separator', tabIndex: 0,
    'aria-label': 'Resize chat', 'aria-orientation': 'vertical',
    'aria-controls': 'character-guide', 'aria-describedby': 'guide-resize-help',
    'aria-valuemin': bounds.min, 'aria-valuemax': bounds.max, 'aria-valuenow': width,
    'aria-valuetext': `${width} pixels wide`,
    title: 'Drag to resize chat between its minimum and maximum width.',
    onPointerDown(event) {
      if (!enabled || !layout.split || event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      event.currentTarget.focus({preventScroll: true});
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {pointerId: event.pointerId, element: event.currentTarget, x: event.clientX, width, lastWidth: width};
      document.documentElement.dataset.guideResizing = 'true';
    },
    onPointerMove(event) {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const next = resolveGuideWidth(current.width + current.x - event.clientX, layout.width);
      current.lastWidth = next.width;
      setDraft(next.width);
    },
    onPointerUp(event) {if (event.pointerId === drag.current?.pointerId) finish(true);},
    onPointerCancel() {finish(false);},
    onLostPointerCapture() {finish(false);},
    onKeyDown(event) {
      if (drag.current || !enabled || !layout.split) return;
      const step = event.shiftKey ? 64 : 24;
      let next: number;
      if (event.key === 'ArrowLeft') next = width + step;
      else if (event.key === 'ArrowRight') next = width - step;
      else if (event.key === 'Home') next = bounds.min;
      else if (event.key === 'End') next = bounds.max;
      else return;
      event.preventDefault();
      setPreferred(resolveGuideWidth(next, layout.width).width);
    },
  };
  return {containerRef, separatorProps, style: {'--guide-width': `${width}px`} as CSSProperties};
}
