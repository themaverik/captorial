/**
 * Browser-side interaction observer.
 *
 * An init script installs capture-phase listeners in every document the context loads (so it
 * survives navigation), and reports each interaction to Node through an exposed binding. The script
 * only ever reports raw facts — attributes, text, geometry — because every judgement worth testing
 * belongs in a pure Node module, not in an injected script.
 *
 * Security notes: the script is passed as a function with its data as an argument, never assembled
 * from strings, and the value of a password field never crosses the binding at all.
 */

import type { BrowserContext, Page } from 'playwright';
import type { ElementDescriptor } from './elementInfo.js';

/** Shortcuts the user presses inside the app to mark a shot. */
export const SHOT_KEYS = {
  anchored: 'Ctrl+Shift+S',
  fullpage: 'Ctrl+Shift+F',
} as const;

const BINDING = '__captorialObserve';
/** Longest string the observer reports for any single field. */
const MAX_TEXT = 200;

/**
 * tsx transpiles this module with esbuild's `keepNames`, which rewrites every named function into
 * `__name(fn, "fn")` and defines `__name` once per module. Playwright serialises the init script by
 * `toString()`, so the calls survive but the helper does not and the script dies with
 * "__name is not defined" before a single listener is installed.
 *
 * A fixed identity stand-in, injected first, restores it. This is a constant with no interpolation:
 * no data ever reaches the page as script text — the observer's own data still travels as an
 * argument to a function-form script.
 */
const KEEP_NAMES_SHIM = 'globalThis.__name = globalThis.__name || function (fn) { return fn; };';

/**
 * An element's box in *document* coordinates. Document rather than viewport space because the page
 * routinely scrolls between an event firing and Node verifying it — tabbing to the next field is
 * enough — and a viewport-relative box would no longer describe the element by then.
 */
export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageMetrics {
  width: number;
  contentHeight: number;
}

/** The action a `change` event implies, derived from the control's tag and type. */
export type ChangeAction = 'fill' | 'select' | 'check' | 'upload';

export type ObservedEvent =
  | { kind: 'click'; element: ElementDescriptor; rect: ElementRect; metrics: PageMetrics }
  | {
      kind: 'change';
      action: ChangeAction;
      checked: boolean;
      element: ElementDescriptor;
      rect: ElementRect;
      metrics: PageMetrics;
    }
  | {
      kind: 'shot-anchored';
      element: ElementDescriptor | null;
      rect: ElementRect | null;
      anchorY: number | null;
      metrics: PageMetrics;
    }
  | { kind: 'shot-fullpage'; metrics: PageMetrics };

/**
 * Runs inside the page. Self-contained by necessity — Playwright serialises it, so it can close over
 * nothing but its argument.
 */
const initScript = (arg: { binding: string; maxText: number }): void => {
  const { binding, maxText } = arg;

  /** Ancestors worth attributing a click to; a click on an inner span means the button. */
  const INTERACTIVE = 'a,button,input,select,textarea,summary,[role],[data-testid]';
  /** Ancestors that make a usable frame anchor. */
  const IDENTIFIABLE =
    '[data-testid],[aria-label],label,h1,h2,h3,h4,h5,h6,input,select,textarea,button,a[href]';
  /** Input types that are buttons: they have no change event, so their click is the interaction. */
  const BUTTON_TYPES = ['button', 'submit', 'reset', 'image'];

  const send = (payload: unknown): void => {
    const fn = (window as unknown as Record<string, ((p: unknown) => void) | undefined>)[binding];
    if (fn) fn(payload);
  };

  const clean = (value: string | null | undefined): string | undefined => {
    if (!value) return undefined;
    const collapsed = value.replace(/\s+/g, ' ').trim();
    return collapsed ? collapsed.slice(0, maxText) : undefined;
  };

  /** A typed value is reported verbatim (only truncated); collapsing it would change the data. */
  const rawValue = (value: unknown): string | undefined =>
    typeof value === 'string' && value ? value.slice(0, maxText) : undefined;

  const labelTextFor = (el: Element): string | undefined => {
    const ids = el.getAttribute('aria-labelledby');
    if (ids) {
      const joined = ids
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ');
      const fromIds = clean(joined);
      if (fromIds) return fromIds;
    }
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length) {
      const fromLabel = clean(labels[0].textContent);
      if (fromLabel) return fromLabel;
    }
    return clean(el.closest('label')?.textContent);
  };

  const describe = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    const input = el as HTMLInputElement;
    const inputType = tag === 'input' ? (input.type || 'text').toLowerCase() : undefined;
    const isPassword = inputType === 'password';
    return {
      tag,
      inputType,
      explicitRole: clean(el.getAttribute('role')),
      ariaLabel: clean(el.getAttribute('aria-label')),
      labelText: labelTextFor(el),
      placeholder: clean(el.getAttribute('placeholder')),
      title: clean(el.getAttribute('title')),
      alt: clean(el.getAttribute('alt')),
      fieldName: clean(el.getAttribute('name')),
      // Only data-testid: it is the attribute the runner's getByTestId resolves by default.
      testid: clean(el.getAttribute('data-testid')),
      text: clean((el as HTMLElement).innerText ?? el.textContent),
      // A password value never crosses this boundary, in either direction.
      value: isPassword ? undefined : rawValue(input.value),
      hasHref: tag === 'a' ? el.hasAttribute('href') : undefined,
      isPassword,
    };
  };

  const rectOf = (el: Element) => {
    const rect = el.getBoundingClientRect();
    // Document coordinates: the page may scroll before Node verifies this element.
    return {
      x: rect.x + window.scrollX,
      y: rect.y + window.scrollY,
      width: rect.width,
      height: rect.height,
    };
  };

  const metrics = () => ({
    width: window.innerWidth,
    contentHeight: Math.ceil(document.documentElement.scrollHeight),
  });

  /** Sticky and fixed chrome sits at the top of the viewport but is a poor frame anchor. */
  const isPinned = (el: Element): boolean => {
    let node: Element | null = el;
    while (node && node !== document.body) {
      const position = getComputedStyle(node).position;
      if (position === 'fixed' || position === 'sticky') return true;
      node = node.parentElement;
    }
    return false;
  };

  /** Beyond this share of the viewport an element is a container, not something to anchor to. */
  const MAX_ANCHOR_FRACTION = 0.6;

  /** Promote a hit-test result to something worth anchoring to, or reject it. */
  const anchorFrom = (hit: Element | null): Element | null => {
    if (!hit || hit === document.body || hit === document.documentElement) return null;
    // Require an identifiable ancestor: falling back to the raw hit lands on layout wrappers whose
    // "text" is the entire page.
    const candidate = hit.closest(IDENTIFIABLE);
    if (!candidate || isPinned(candidate)) return null;
    if (candidate.getBoundingClientRect().height > window.innerHeight * MAX_ANCHOR_FRACTION) {
      return null;
    }
    return candidate;
  };

  /**
   * The element to pin to the top of an anchored frame: whatever the user last focused if it sits in
   * the upper half of the viewport, otherwise the topmost identifiable, unpinned element on screen.
   *
   * Probes three columns rather than only the centre — a narrow left-aligned form leaves the centre
   * over empty layout, which would otherwise anchor the frame to the form wrapper.
   */
  const anchorElement = (): Element | null => {
    const active = document.activeElement;
    if (active && active !== document.body && !isPinned(active)) {
      const rect = active.getBoundingClientRect();
      if (rect.top >= 0 && rect.top < window.innerHeight / 2) return active;
    }
    const columns = [0.15, 0.5, 0.85].map((fraction) => Math.round(window.innerWidth * fraction));
    for (let y = 4; y < window.innerHeight / 2; y += 16) {
      let best: { el: Element; top: number } | null = null;
      for (const x of columns) {
        const candidate = anchorFrom(document.elementFromPoint(x, y));
        if (!candidate) continue;
        const top = candidate.getBoundingClientRect().top;
        if (!best || top < best.top) best = { el: candidate, top };
      }
      if (best) return best.el;
    }
    return null;
  };

  /** True when this element's meaning comes from its `change` event, so its click is noise. */
  const changeDrivesIt = (el: Element): boolean => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'select' || tag === 'textarea' || tag === 'label') return true;
    if (tag !== 'input') return false;
    return !BUTTON_TYPES.includes(((el as HTMLInputElement).type || 'text').toLowerCase());
  };

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target as Element | null;
      if (!target || target.nodeType !== 1) return;
      const el = target.closest(INTERACTIVE) ?? target;
      // Skip controls whose interaction is reported as a change, so one act is not recorded twice.
      if (changeDrivesIt(el)) return;
      send({ kind: 'click', element: describe(el), rect: rectOf(el), metrics: metrics() });
    },
    true,
  );

  /** The change payload for a form control, or null when the element is not one. */
  const changePayload = (el: Element): unknown => {
    const tag = el.tagName.toLowerCase();
    if (tag !== 'input' && tag !== 'select' && tag !== 'textarea') return null;
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    const action =
      tag === 'select'
        ? 'select'
        : type === 'checkbox' || type === 'radio'
          ? 'check'
          : type === 'file'
            ? 'upload'
            : 'fill';
    return {
      kind: 'change',
      action,
      checked: Boolean((el as HTMLInputElement).checked),
      element: describe(el),
      rect: rectOf(el),
      metrics: metrics(),
    };
  };

  /**
   * A field that has been typed into but not yet committed. Editing only fires `change` on blur, so
   * a shot taken while a field still has focus would otherwise be ordered before the value that was
   * already typed into it.
   */
  let pendingInput: Element | null = null;
  /** What a flush already reported, so the real `change` on blur is not recorded a second time. */
  let flushed: { el: Element; value: string } | null = null;

  const currentValue = (el: Element): string => {
    const value = (el as HTMLInputElement).value;
    return typeof value === 'string' ? value : '';
  };

  const flushPending = (): void => {
    const el = pendingInput;
    pendingInput = null;
    if (!el) return;
    const payload = changePayload(el);
    if (!payload) return;
    flushed = { el, value: currentValue(el) };
    send(payload);
  };

  document.addEventListener(
    'input',
    (event) => {
      const el = event.target as Element | null;
      if (el && el.nodeType === 1) pendingInput = el;
    },
    true,
  );

  document.addEventListener(
    'change',
    (event) => {
      const el = event.target as Element | null;
      if (!el || el.nodeType !== 1) return;
      if (pendingInput === el) pendingInput = null;
      // A flush already reported this exact value; the blur that follows is the same edit.
      if (flushed && flushed.el === el && flushed.value === currentValue(el)) {
        flushed = null;
        return;
      }
      flushed = null;
      const payload = changePayload(el);
      if (payload) send(payload);
    },
    true,
  );

  document.addEventListener(
    'keydown',
    (event) => {
      if (!event.ctrlKey || !event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key !== 's' && key !== 'f') return;
      event.preventDefault();
      event.stopPropagation();
      // Commit any half-typed field first, so the value is ordered before the shot it precedes.
      flushPending();
      if (key === 'f') {
        send({ kind: 'shot-fullpage', metrics: metrics() });
        return;
      }
      const anchor = anchorElement();
      send({
        kind: 'shot-anchored',
        element: anchor ? describe(anchor) : null,
        rect: anchor ? rectOf(anchor) : null,
        anchorY: anchor ? Math.round(anchor.getBoundingClientRect().top + window.scrollY) : null,
        metrics: metrics(),
      });
    },
    true,
  );
};

/**
 * Install the observer on a context. Register before opening a page so the init script is present
 * from the first document. A handler that throws must not break the app under test, so failures are
 * swallowed here and surfaced by the session instead.
 */
export const installObserver = async (
  context: BrowserContext,
  onEvent: (page: Page, event: ObservedEvent) => Promise<void>,
): Promise<void> => {
  // Handlers must run one at a time. A spec is an ordered stream, so concurrent handlers could
  // record steps out of order; and each one measures the live page, which a later interaction would
  // otherwise be free to scroll out from under it.
  let queue: Promise<void> = Promise.resolve();
  await context.exposeBinding(BINDING, (source, payload) => {
    queue = queue
      .then(() => onEvent(source.page, payload as ObservedEvent))
      .catch(() => undefined); // reported by the session; never propagate into the page
    return queue;
  });
  // Order matters: init scripts run in registration order, and the shim must land first.
  await context.addInitScript({ content: KEEP_NAMES_SHIM });
  await context.addInitScript(initScript, { binding: BINDING, maxText: MAX_TEXT });
};
