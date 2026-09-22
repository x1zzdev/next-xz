import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildAuditCard,
  createInMemoryAuditRegistry,
  getAuditModule,
  listAuditModules,
} from "../src/index.js";

const SOURCE = `/// @intent Sums line items.
/// @effects none
@export func total(subtotal: Float) -> Float
    post result >= 0.0
{
    subtotal
}
`;

const pending = buildAuditCard({ module: "order", source: SOURCE });
const approved = buildAuditCard({
  module: "billing",
  source: SOURCE,
  status: "approved",
});

const registry = createInMemoryAuditRegistry([pending, approved]);

test("lists only modules awaiting a decision", async () => {
  const handler = listAuditModules(registry);
  const response = await handler(new Request("http://localhost/___audit"));
  assert.equal(response.status, 200);
  const body = (await response.json()) as readonly { module: string }[];
  assert.deepEqual(
    body.map((card) => card.module),
    ["order"],
  );
});

test("returns one module's card", async () => {
  const handler = getAuditModule(registry);
  const response = await handler(new Request("http://localhost/___audit/order"), {
    params: Promise.resolve({ module: "order" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), pending);
});

test("answers 404 for an unknown module", async () => {
  const handler = getAuditModule(registry);
  const response = await handler(new Request("http://localhost/___audit/missing"), {
    params: Promise.resolve({ module: "missing" }),
  });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "unknown module 'missing'" });
});
