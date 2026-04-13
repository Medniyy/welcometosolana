import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs/promises";

async function main() {
  const [, , inPathArg, outPathArg] = process.argv;
  if (!inPathArg || !outPathArg) {
    console.error("Usage: node scripts/render_svg_to_png.mjs <in.svg> <out.png>");
    process.exit(1);
  }

  const inPath = path.resolve(inPathArg);
  const outPath = path.resolve(outPathArg);

  await fs.mkdir(path.dirname(outPath), { recursive: true });

  const svgText = await fs.readFile(inPath, "utf8");

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });

  await page.setContent(`
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          html, body { margin: 0; width: 100%; height: 100%; background: transparent; }
          .wrap { width: 100%; height: 100%; display: grid; place-items: center; }
          svg { width: 860px; height: 860px; }
        </style>
      </head>
      <body>
        <div class="wrap">
          ${svgText}
        </div>
      </body>
    </html>
  `);
  await page.waitForTimeout(200);
  await page.screenshot({ path: outPath, type: "png", omitBackground: true });
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

