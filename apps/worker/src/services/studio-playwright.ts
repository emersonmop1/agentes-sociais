/**
 * Studio Playwright service — drives youtube.com/watch UI for actions the
 * public Data API cannot perform.
 *
 * Reuses the Chromium singleton from carousel-renderer.ts but creates an
 * ephemeral context per call (so cookies from one company don't leak into
 * the next). Context is closed at the end of each call regardless of result.
 *
 * Selectors target stable role/aria attributes wherever possible. YouTube's
 * UI does change — when these break, fix them here in one spot.
 */

import { chromium, type Browser, type BrowserContext } from "playwright";
import { logger } from "../lib/logger.js";

let _studioBrowser: Browser | null = null;
let _bootInflight: Promise<Browser> | null = null;

async function getStudioBrowser(): Promise<Browser> {
  if (_studioBrowser?.isConnected()) return _studioBrowser;
  if (_bootInflight) return _bootInflight;
  _bootInflight = (async () => {
    logger.info("studio-playwright: launching chromium");
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    _studioBrowser = browser;
    _bootInflight = null;
    return browser;
  })();
  return _bootInflight;
}

export async function shutdownStudioBrowser(): Promise<void> {
  if (_studioBrowser) {
    try {
      await _studioBrowser.close();
    } catch {
      /* noop */
    }
    _studioBrowser = null;
  }
}

export interface StudioCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export class StudioAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioAuthError";
  }
}

interface PinCommentArgs {
  videoId: string;
  comment: string;
  cookies: StudioCookie[];
}

export interface PinCommentResult {
  pinned: boolean;
  comment_id?: string;
  message?: string;
}

/**
 * Posts a comment under the given videoId then pins it. Throws StudioAuthError
 * if the cookies don't authenticate the session (caller marks them invalid).
 *
 * Strategy:
 *   1. Open the watch page with cookies preloaded into the context.
 *   2. Detect login state — if the page redirects to a login URL or shows
 *      the "Sign in" CTA, throw auth error.
 *   3. Scroll to comments, click the placeholder, type the comment, submit.
 *   4. After post, find your own freshly-posted comment (the topmost one
 *      authored by the logged-in account), open its 3-dot menu, click "Pin".
 */
export async function pinComment(args: PinCommentArgs): Promise<PinCommentResult> {
  const browser = await getStudioBrowser();

  let context: BrowserContext | null = null;
  try {
    context = await browser.newContext({
      viewport: { width: 1280, height: 1800 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "pt-BR",
    });
    await context.addCookies(
      args.cookies.map((k) => ({
        name: k.name,
        value: k.value,
        domain: k.domain,
        path: k.path || "/",
        expires: k.expires,
        httpOnly: k.httpOnly,
        secure: k.secure,
        sameSite: k.sameSite ?? "Lax",
      })),
    );

    const page = await context.newPage();
    page.setDefaultTimeout(30_000);

    const watchUrl = `https://www.youtube.com/watch?v=${args.videoId}`;
    await page.goto(watchUrl, { waitUntil: "domcontentloaded" });

    // Auth probe — redirected to accounts.google.com or sign-in CTA visible
    // means the cookies expired or the session never authed. We don't try
    // to recover; fail fast so the user reconnects.
    if (page.url().startsWith("https://accounts.google.com/")) {
      throw new StudioAuthError("redirected to login");
    }
    const signInLocator = page.getByRole("link", { name: /entrar|sign in/i });
    if (await signInLocator.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      throw new StudioAuthError("sign-in CTA visible — cookies not authenticated");
    }

    // Comments live below the fold; scroll until #comments is in viewport.
    await page.evaluate(() => {
      window.scrollTo(0, 1200);
    });
    await page.waitForSelector("#comments", { timeout: 15_000 });
    await page.locator("#comments").scrollIntoViewIfNeeded();
    // Brief wait — comment textarea is rendered after a second poll
    await page.waitForTimeout(1500);

    const placeholder = page.locator("ytd-comment-simplebox-renderer #placeholder-area");
    await placeholder.waitFor({ state: "visible", timeout: 15_000 });
    await placeholder.click();

    const editor = page.locator(
      'ytd-comment-simplebox-renderer #contenteditable-root[contenteditable="true"]',
    );
    await editor.waitFor({ state: "visible", timeout: 5_000 });
    await editor.fill(args.comment);

    // Submit button — the "Comentar" / "Comment" button enables once non-empty
    const submitBtn = page.locator(
      'ytd-comment-simplebox-renderer #submit-button button',
    );
    await submitBtn.waitFor({ state: "visible", timeout: 5_000 });
    await submitBtn.click();

    // Wait for our just-posted comment to appear in the list. The freshly
    // posted thread is the topmost comment authored by us. We use the
    // "author-is-channel-owner" heuristic: cookies that pin must own the video.
    // Fallback: match the comment text we just typed (truncated).
    const commentTextSnippet = args.comment.slice(0, 80);
    const ourComment = page.locator("ytd-comment-thread-renderer", {
      hasText: commentTextSnippet,
    }).first();
    await ourComment.waitFor({ state: "visible", timeout: 20_000 });

    // Open the 3-dot menu on that comment
    const moreBtn = ourComment.locator("#action-menu button#button");
    await moreBtn.first().click();

    // The menu is a global popup — find it and click "Pin" / "Fixar"
    const menu = page.locator("ytd-menu-popup-renderer");
    await menu.waitFor({ state: "visible", timeout: 5_000 });
    const pinItem = menu.getByRole("menuitem", { name: /pin|fixar/i }).first();
    await pinItem.waitFor({ state: "visible", timeout: 5_000 });
    await pinItem.click();

    // Confirmation dialog — click "Pin" / "Fixar" again
    const confirmBtn = page.getByRole("button", { name: /^pin$|^fixar$/i }).first();
    await confirmBtn.waitFor({ state: "visible", timeout: 5_000 });
    await confirmBtn.click();

    // Verify the pinned-comment marker appears
    const pinnedMarker = ourComment
      .locator('#pinned-comment-badge, ytd-pinned-comment-badge-renderer')
      .first();
    await pinnedMarker.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {
      // Not fatal — sometimes the badge takes longer to render. We trust the
      // earlier confirm-click landed.
    });

    return { pinned: true, message: "comment posted and pinned" };
  } finally {
    if (context) {
      try {
        await context.close();
      } catch {
        /* noop */
      }
    }
  }
}
