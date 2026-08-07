import "server-only";
import type { Page } from "playwright";

export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function humanDelay(min: number, max: number): Promise<void> {
  return wait(randomInt(min, max));
}

export async function humanScroll(page: Page): Promise<void> {
  const steps = randomInt(2, 5);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, randomInt(120, 400));
    await humanDelay(400, 900);
  }
}

export async function humanMoveTo(
  page: Page,
  box: BoundingBox | null,
): Promise<void> {
  if (!box) return;
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const moves = randomInt(3, 6);
  for (let i = 0; i < moves - 1; i++) {
    const x = centerX + randomInt(-40, 40);
    const y = centerY + randomInt(-40, 40);
    await page.mouse.move(x, y, { steps: randomInt(8, 14) });
    await humanDelay(80, 220);
  }
  await page.mouse.move(centerX, centerY, { steps: randomInt(8, 14) });
}

export async function typeHumanLike(page: Page, text: string): Promise<void> {
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: randomInt(40, 120) });
  }
}
