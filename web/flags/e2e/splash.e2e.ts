import { expect, test, type Page } from "@playwright/test";

// The About splash: once per browser session, over the sign-in page, out of the way with Enter or
// "Explore Demo", back from "About this demo" in the sidebar. Reads only; no writes.
const splashOf = (page: Page) => page.getByRole("dialog", { name: "Flags. Flipped." });

test("a new session opens on the splash, once, and the sidebar opens it again", async ({ page }) => {
  await page.goto("/");
  const splash = splashOf(page);
  await expect(splash).toBeVisible();
  await expect(splash).toContainText("Demo built with Vantage UI");
  await expect(splash).toContainText('Build "Flags": a feature-flag service for a white-label banking platform');
  await expect(splash).toContainText("prompt from the person");
  await expect(splash).toContainText("LLM with Vantage built it 8 times faster");
  await expect(splash.getByRole("link", { name: /Build your own/ })).toHaveAttribute("href", "https://vantage-ui.com/download/");
  await page.keyboard.press("Enter");
  await expect(splash).toBeHidden();

  await page.reload();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(splashOf(page)).toBeHidden();

  await page.getByLabel("Email").fill("support@example.com");
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "About this demo" }).click();
  await expect(splashOf(page)).toBeVisible();
  await page.getByRole("button", { name: /Explore Demo/ }).click();
  await expect(splashOf(page)).toBeHidden();

  await page.getByRole("button", { name: "About this demo" }).click();
  await expect(splashOf(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(splashOf(page)).toBeHidden();
});
