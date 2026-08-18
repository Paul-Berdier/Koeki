import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webDirectory = path.resolve(scriptDirectory, "..");
const appDirectory = path.join(webDirectory, "app");
const publicIconDirectory = path.join(webDirectory, "public", "icons");
const source = path.join(appDirectory, "icon.svg");

await mkdir(publicIconDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

async function render(size) {
  await page.setViewportSize({ width: size, height: size });
  await page.goto(pathToFileURL(source).href);
  await page.locator("svg").evaluate((svg) => {
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.display = "block";
  });
  return page.screenshot({ type: "png" });
}

let appleIcon;
let icon192;
let icon512;
const faviconImages = [];

try {
  appleIcon = await render(180);
  icon192 = await render(192);
  icon512 = await render(512);
  for (const size of [16, 32, 48, 256]) {
    faviconImages.push({ size, data: await render(size) });
  }
} finally {
  await browser.close();
}

await Promise.all([
  writeFile(path.join(appDirectory, "apple-icon.png"), appleIcon),
  writeFile(path.join(publicIconDirectory, "koeki-192.png"), icon192),
  writeFile(path.join(publicIconDirectory, "koeki-512.png"), icon512),
]);

function createIco(images) {
  const headerSize = 6 + images.length * 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let imageOffset = headerSize;
  images.forEach(({ size, data }, index) => {
    const entryOffset = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, entryOffset);
    header.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
    header.writeUInt8(0, entryOffset + 2);
    header.writeUInt8(0, entryOffset + 3);
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(data.length, entryOffset + 8);
    header.writeUInt32LE(imageOffset, entryOffset + 12);
    imageOffset += data.length;
  });

  return Buffer.concat([header, ...images.map(({ data }) => data)]);
}

await writeFile(path.join(appDirectory, "favicon.ico"), createIco(faviconImages));

const sourceBytes = await readFile(source);
console.log(`Generated Kōeki icons from ${sourceBytes.length} bytes of SVG source.`);
