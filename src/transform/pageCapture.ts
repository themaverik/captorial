/**
 * Playwright-coupled screenshot capture and storage for the transform layer.
 *
 * Grows the viewport so a fixed-height, inner-scrolling panel expands to its full content height,
 * then captures the whole form while keeping the real web layout (header, form, side map). Short
 * content yields one image; tall content is split into overlapping 16:9 tiles (see tileGeometry).
 *
 * App-agnostic: it takes a `contentSelector`, `topAnchorSelectors`, and an `onSettle` hook as
 * options rather than assuming any particular app's DOM. The framing math lives in tileGeometry.
 */

import path from 'node:path';
import type { Page } from 'playwright';
import { clampViewportHeight, computeTileClips } from './tileGeometry.js';
import type { TileCaptureOptions } from './types.js';

const DEFAULT_CONTENT_SELECTOR = 'form';

export class PageTransform {
  constructor(
    private readonly page: Page,
    private readonly options: TileCaptureOptions,
  ) {}

  private get contentSelector(): string {
    return this.options.contentSelector || DEFAULT_CONTENT_SELECTOR;
  }

  private async settle(): Promise<void> {
    if (this.options.onSettle) await this.options.onSettle();
  }

  /**
   * Grow the viewport tall enough that the content root's inner-scrolling panel expands to reveal
   * the whole form, so a normal full-page shot keeps the real web layout while showing every field.
   * Returns a restore callback that sets the viewport back for subsequent interactions.
   */
  async growViewportToFitForm(): Promise<() => Promise<void>> {
    const current = this.page.viewportSize() || { width: 1920, height: 1080 };
    const needed = await this.page.evaluate((selector) => {
      const content = document.querySelector(selector);
      if (!content) return document.body.scrollHeight;
      // Find the nearest scrollable ancestor (the panel that clips the content).
      let node: HTMLElement | null = content as HTMLElement;
      let panel: HTMLElement | null = null;
      while (node) {
        const style = getComputedStyle(node);
        if (/(auto|scroll)/.test(style.overflowY) || node.scrollHeight > node.clientHeight + 4) {
          panel = node;
          break;
        }
        node = node.parentElement;
      }
      const target = panel || (content as HTMLElement);
      const top = target.getBoundingClientRect().top + window.scrollY;
      // top ~= header offset; scrollHeight = full form content; buffer for the fixed action bar.
      return Math.ceil(top + target.scrollHeight + 240);
    }, this.contentSelector);

    const height = clampViewportHeight(needed, current.height, this.options.maxViewportHeightPx);
    await this.page.setViewportSize({ width: current.width, height });
    // Let the layout reflow and any side map re-render tiles into the taller container before
    // shooting. Nudge a resize, then wait for tile requests to settle so the map does not capture
    // with dark, half-loaded bands.
    await this.page.evaluate(() => window.dispatchEvent(new Event('resize'))).catch(() => undefined);
    await this.page.waitForTimeout(1200);
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
    await this.settle();
    return async () => {
      await this.page.setViewportSize(current);
      await this.page.waitForTimeout(150);
    };
  }

  /**
   * Grow the viewport to fit the whole form, reset scroll so tile 1 starts at the top, then capture:
   *  - one image when the content fits a single 16:9 frame (or cropping is disabled), or
   *  - N overlapping 16:9 tiles at full width for a tall form.
   * Writes the file(s) into `dir` (`<base>.png`, or `<base>-1.png`, `<base>-2.png`, …) and returns
   * their absolute paths. Restores the viewport afterwards.
   */
  async captureWebpageTiles(dir: string, base: string): Promise<string[]> {
    const restoreViewport = await this.growViewportToFitForm();
    try {
      // After the viewport grows and the app re-renders, reset scroll on ALL scrollable containers
      // so tile 1 starts from the top of the content, not wherever the last scrollIntoView landed.
      await this.page
        .evaluate((anchorSelectors) => {
          document.querySelectorAll('*').forEach((el) => {
            const h = el as HTMLElement;
            if (h.scrollTop > 0) h.scrollTop = 0;
            if (h.scrollLeft > 0) h.scrollLeft = 0;
          });
          window.scrollTo(0, 0);
          // Bring the content top into view so it appears at the top of tile 1.
          let anchor: Element | null = null;
          for (const selector of anchorSelectors) {
            anchor = document.querySelector(selector);
            if (anchor) break;
          }
          if (anchor) anchor.scrollIntoView({ block: 'start', behavior: 'instant' as ScrollBehavior });
        }, this.options.topAnchorSelectors || [this.contentSelector])
        .catch(() => undefined);
      await this.page.waitForTimeout(300);

      const viewport = this.page.viewportSize() || { width: 1920, height: 1080 };
      const width = viewport.width;
      const contentHeight = await this.page.evaluate(() =>
        Math.ceil(document.documentElement.scrollHeight),
      );
      // Clip must stay within the rendered viewport, which we grew to (at most) the content height.
      const usableHeight = Math.min(contentHeight, viewport.height);

      const clips = computeTileClips({
        width,
        usableHeight,
        aspectWidth: this.options.aspectWidth,
        aspectHeight: this.options.aspectHeight,
        cropTo169: this.options.cropTo169,
      });

      const written: string[] = [];
      const single = clips.length === 1;
      for (let index = 0; index < clips.length; index += 1) {
        const suffix = single ? '' : `-${index + 1}`;
        const dest = path.join(dir, `${base}${suffix}.png`);
        await this.page.screenshot({ path: dest, clip: clips[index] });
        written.push(dest);
      }
      return written;
    } finally {
      await restoreViewport();
    }
  }

  /**
   * Neutralise the inner scroll container(s) so the form lays out at its natural full height before
   * an element screenshot ('form' capture mode). Walks from the content root up to <html> and, for
   * any scrollable ancestor, removes the height cap and clipping, then pads the content for
   * breathing room. Idempotent.
   */
  async prepareForCapture(): Promise<void> {
    await this.page
      .evaluate(
        ({ selector, paddingPx }) => {
          const content = document.querySelector(selector);
          if (!content) return;
          let node: HTMLElement | null = content as HTMLElement;
          while (node) {
            const style = getComputedStyle(node);
            const scrolls =
              /(auto|scroll)/.test(style.overflowY) ||
              /(auto|scroll)/.test(style.overflow) ||
              node.scrollHeight > node.clientHeight + 4;
            if (scrolls) {
              node.style.setProperty('max-height', 'none', 'important');
              node.style.setProperty('height', 'auto', 'important');
              node.style.setProperty('overflow', 'visible', 'important');
            }
            node = node.parentElement;
          }
          const target = content as HTMLElement;
          target.style.setProperty('box-sizing', 'border-box', 'important');
          target.style.setProperty('padding', `${paddingPx}px`, 'important');
          target.style.setProperty('background', '#ffffff', 'important');
        },
        { selector: this.contentSelector, paddingPx: this.options.capturePaddingPx },
      )
      .catch(() => undefined);
    // Let layout settle after unclipping before the caller screenshots.
    await this.page.waitForTimeout(150);
  }
}
