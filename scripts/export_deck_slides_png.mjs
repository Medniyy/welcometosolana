import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function mustExist(p) {
  if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
}

async function main() {
  const deckPath = process.argv[2];
  const outDir = process.argv[3];

  if (!deckPath || !outDir) {
    console.error("Usage: node scripts/export_deck_slides_png.mjs <deck.html> <outDir>");
    process.exit(2);
  }

  const absDeckPath = path.resolve(deckPath);
  const absOutDir = path.resolve(outDir);
  mustExist(absDeckPath);
  fs.mkdirSync(absOutDir, { recursive: true });

  const deckUrl = pathToFileURL(absDeckPath).toString();

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
  });

  await page.goto(deckUrl, { waitUntil: "load" });

  // Make sure slide JS is ready.
  await page.waitForFunction(() => document.querySelectorAll(".slide").length > 0);

  const total = await page.evaluate(() => document.querySelectorAll(".slide").length);

  // Helper: navigate to a given slide index.
  async function gotoIndex(i) {
    const hasGo = await page.evaluate(() => typeof window.go === "function");
    if (hasGo) {
      await page.evaluate((idx) => window.go(idx), i);
      return;
    }

    // Fallback: use ArrowLeft/ArrowRight navigation.
    // First, reset to slide 0 by pressing ArrowLeft a bunch.
    for (let k = 0; k < total + 2; k++) {
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(30);
    }
    for (let k = 0; k < i; k++) {
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(45);
    }
  }

  for (let i = 0; i < total; i++) {
    await gotoIndex(i);
    await page.waitForTimeout(120);

    const filename = `${String(i + 1).padStart(2, "0")}.png`;
    const outPath = path.join(absOutDir, filename);
    await page.screenshot({ path: outPath });
  }

  await browser.close();
  console.log(`Exported ${total} slides to ${absOutDir}`);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

