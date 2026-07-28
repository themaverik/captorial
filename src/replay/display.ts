/**
 * Display-derived viewport sizing.
 *
 * Headless capture wants a large, fixed viewport so output is identical on every machine. A headed
 * run has to fit inside a real window: Playwright emulates the viewport, so a viewport wider than
 * the screen lays the page out beyond the window with no scrollbars and puts controls out of reach.
 *
 * `probeDisplay` measures the host window (Playwright-coupled, verified against a live browser);
 * `fitViewport` is the pure sizing rule and is unit-tested.
 */

import type { Browser } from 'playwright';

/** Capture viewport used when nothing is overridden and no display constrains it. */
export const DEFAULT_VIEWPORT = { width: 1920, height: 1080 };

export interface Viewport {
  width: number;
  height: number;
}

/**
 * Parse a `WIDTHxHEIGHT` override. Returns undefined for anything unparseable — an override that
 * cannot be read falls back to the derived size rather than failing the run.
 */
export const parseViewport = (value: string | undefined): Viewport | undefined => {
  const match = /^(\d+)\s*[x*]\s*(\d+)$/i.exec((value ?? '').trim());
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : undefined;
};

/** What a real browser window on this machine can show, in CSS pixels. */
export interface DisplayMetrics {
  /** Usable screen area, excluding OS chrome such as the taskbar. */
  availWidth: number;
  availHeight: number;
  /** Browser chrome (tab strip, address bar) height — measured, not assumed. */
  chromeHeight: number;
}

/**
 * Measure the host display by opening a throwaway maximised window. It has to be a real window with
 * no viewport emulation: under emulation `screen.avail*` reports the emulated size, not the display.
 * Returns null if the probe fails, so a run never dies for want of a debugging convenience.
 */
export const probeDisplay = async (browser: Browser): Promise<DisplayMetrics | null> => {
  let context;
  try {
    context = await browser.newContext({ viewport: null });
    const page = await context.newPage();
    return await page.evaluate(() => ({
      availWidth: window.screen.availWidth,
      availHeight: window.screen.availHeight,
      chromeHeight: Math.max(0, window.outerHeight - window.innerHeight),
    }));
  } catch {
    return null;
  } finally {
    await context?.close().catch(() => undefined);
  }
};

/**
 * Shrink `preferred` to what the display can actually show, preserving its aspect ratio so framing
 * stays proportional. Never grows the viewport: a big screen still gets the canonical capture size.
 */
export const fitViewport = (preferred: Viewport, display: DisplayMetrics | null): Viewport => {
  if (!display) return preferred;
  const usableWidth = Math.max(1, display.availWidth);
  const usableHeight = Math.max(1, display.availHeight - display.chromeHeight);
  const scale = Math.min(1, usableWidth / preferred.width, usableHeight / preferred.height);
  if (scale >= 1) return preferred;
  return {
    width: Math.max(1, Math.floor(preferred.width * scale)),
    height: Math.max(1, Math.floor(preferred.height * scale)),
  };
};
