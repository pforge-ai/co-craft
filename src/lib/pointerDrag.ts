interface DragStart {
  currentTarget: EventTarget & HTMLElement;
  pointerId: number;
  clientX: number;
  clientY: number;
  button: number;
  preventDefault(): void;
}
/** Keep a drag in one document, including when it crosses a video iframe. */
export function pointerDrag(
  event: DragStart,
  move: (x: number, y: number) => void,
  end?: (x: number, y: number) => void,
  cursor = 'col-resize',
) {
  if (event.button !== 0) return () => {};
  event.preventDefault();
  const element = event.currentTarget,
    id = event.pointerId;
  let latest = { x: event.clientX, y: event.clientY },
    frame = 0,
    finished = false;
  const shield = document.createElement('div');
  shield.className = 'pointer-drag-shield';
  shield.style.cursor = cursor;
  shield.setAttribute('aria-hidden', 'true');
  document.body.append(shield);
  document.body.dataset.resizing = 'true';
  const flush = () => {
    frame = 0;
    move(latest.x, latest.y);
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    if (frame) {
      cancelAnimationFrame(frame);
      flush();
    }
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onEnd, true);
    window.removeEventListener('pointercancel', onEnd, true);
    window.removeEventListener('blur', finish);
    element.removeEventListener('lostpointercapture', finish);
    if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
    shield.remove();
    delete document.body.dataset.resizing;
    end?.(latest.x, latest.y);
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    if (!e.buttons) {
      finish();
      return;
    }
    latest = { x: e.clientX, y: e.clientY };
    if (!frame) frame = requestAnimationFrame(flush);
  };
  const onEnd = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    if (e.type === 'pointerup' && (latest.x !== e.clientX || latest.y !== e.clientY)) {
      latest = { x: e.clientX, y: e.clientY };
      if (!frame) frame = requestAnimationFrame(flush);
    }
    finish();
  };
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onEnd, true);
  window.addEventListener('pointercancel', onEnd, true);
  window.addEventListener('blur', finish);
  element.addEventListener('lostpointercapture', finish);
  try {
    element.setPointerCapture(id);
  } catch {
    /* the shield keeps fallback events in this document */
  }
  return finish;
}
