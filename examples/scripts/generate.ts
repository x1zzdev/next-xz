import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { generateBinding, parseInterface, type GenerateOptions } from "@xz-lang/bridge";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const ORDER_INTERFACE = join(root, "order.xzint");
export const ORDER_SOURCE = join(root, "order.xz");
export const ORDER_BINDING = join(root, "src", "xz", "order.ts");

export const orderGenerateOptions: GenerateOptions = {
  name: "order",
  libraryPath: ".next-xz/liborder.so",
  xzVersion: "0.1.0",
};

export async function generateOrderBinding(): Promise<string> {
  const iface = parseInterface(await readFile(ORDER_INTERFACE, "utf8"), "order.xzint");
  return generateBinding(iface, orderGenerateOptions);
}

async function main(): Promise<void> {
  await writeFile(ORDER_BINDING, await generateOrderBinding(), "utf8");
  console.log(`wrote ${ORDER_BINDING}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
