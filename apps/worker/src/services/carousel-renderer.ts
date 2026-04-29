/**
 * Carousel renderer — Playwright singleton + Handlebars templates.
 *
 * Lazy-init a Chromium instance the first time render() is called.
 * Pages are NOT pooled in v1 — each render creates its own page so
 * concurrent renders don't share viewport state. Page creation is cheap
 * once the browser is up. Pool comes in Fatia 9 if profiling shows a need.
 *
 * Templates loaded once at module init from src/templates/*.hbs (relative
 * to the worker dist directory — we ship templates alongside the build).
 */

import Handlebars from "handlebars";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { logger } from "../lib/logger.js";

export type VisualStyleSlug =
  | "tweet_thread"
  | "dark"
  | "acid_text"
  | "tweet_single";

export interface SlideData {
  index: number;
  title: string;
  subtitle?: string;
  body?: string;
  is_cover?: boolean;
  is_cta?: boolean;
  image?: { url: string; credit?: string } | null;
  background_color?: string;
  highlight_color?: string;
  /** Populated after a slide is uploaded. */
  rendered_url?: string | null;
  rendered_at?: string | null;
}

export interface BrandData {
  brand_name: string;
  handle?: string;
  initial?: string;
  badge_verified?: boolean;
  avatar_url?: string;
  logo_url?: string;
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  background_color?: string;
  text_color?: string;
}

// ─── Templates ──────────────────────────────────────────────────────────

const TEMPLATES_DIR = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  // Worker has its own templates copy under apps/worker/src/templates
  // (or worker/dist/templates after build). Resolve relative to import.meta.url.
  return resolve(here, "../templates");
})();

let cachedTemplates: Record<VisualStyleSlug, Handlebars.TemplateDelegate> | null = null;

async function loadTemplates(): Promise<Record<VisualStyleSlug, Handlebars.TemplateDelegate>> {
  if (cachedTemplates) return cachedTemplates;
  const slugs: VisualStyleSlug[] = ["tweet_thread", "dark", "acid_text", "tweet_single"];
  const out = {} as Record<VisualStyleSlug, Handlebars.TemplateDelegate>;
  for (const slug of slugs) {
    const src = await readFile(join(TEMPLATES_DIR, `${slug}.hbs`), "utf8");
    out[slug] = Handlebars.compile(src, { noEscape: false });
  }
  cachedTemplates = out;
  return out;
}

function buildBrandViewModel(brand: BrandData): Record<string, unknown> {
  const initial = (brand.brand_name?.trim()?.[0] ?? "?").toUpperCase();
  return {
    ...brand,
    initial,
    handle: brand.handle ?? `@${(brand.brand_name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")}`,
    primary_color: brand.primary_color ?? "#22c55e",
    secondary_color: brand.secondary_color ?? "#16a34a",
    accent_color: brand.accent_color ?? "#f59e0b",
    background_color: brand.background_color ?? "#ffffff",
    text_color: brand.text_color ?? "#0f172a",
  };
}

// ─── Browser singleton ──────────────────────────────────────────────────

let _browser: Browser | null = null;
let _context: BrowserContext | null = null;
let _bootInflight: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (_browser?.isConnected()) return _browser;
  if (_bootInflight) return _bootInflight;
  _bootInflight = (async () => {
    logger.info("playwright: launching chromium");
    const browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage", // Fly.io has small /dev/shm
      ],
    });
    _browser = browser;
    _context = await browser.newContext({
      viewport: { width: 1080, height: 1350 },
      deviceScaleFactor: 2,
    });
    _bootInflight = null;
    return browser;
  })();
  return _bootInflight;
}

export async function shutdownBrowser(): Promise<void> {
  if (_context) {
    try { await _context.close(); } catch { /* noop */ }
    _context = null;
  }
  if (_browser) {
    try { await _browser.close(); } catch { /* noop */ }
    _browser = null;
  }
}

// ─── Render ─────────────────────────────────────────────────────────────

export interface RenderSlideArgs {
  visualStyle: VisualStyleSlug;
  slide: SlideData;
  brand: BrandData;
  /** Total slides in the carousel (used to flag last/cta differently). */
  totalSlides: number;
}

export async function renderSlide(args: RenderSlideArgs): Promise<Buffer> {
  await getBrowser();
  const ctx = _context!;
  const templates = await loadTemplates();
  const tpl = templates[args.visualStyle];
  if (!tpl) throw new Error(`Unknown visual_style: ${args.visualStyle}`);

  const html = tpl({
    ...args.slide,
    is_cover_or_cta: args.slide.is_cover || args.slide.is_cta,
    brand: buildBrandViewModel(args.brand),
  });

  const page = await ctx.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle", timeout: 20_000 });
    // Fonts may load after networkidle on first hit — give them a beat.
    await page.evaluate(() => (document.fonts as unknown as { ready: Promise<unknown> }).ready);
    const png = await page.screenshot({ type: "png", fullPage: false, clip: { x: 0, y: 0, width: 1080, height: 1350 } });
    return Buffer.from(png);
  } finally {
    await page.close().catch(() => undefined);
  }
}
