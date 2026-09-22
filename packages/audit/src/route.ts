import type { AuditCard, AuditStatus } from "./card.js";

export interface AuditRegistry {
  list(): Promise<readonly AuditCard[]>;
  get(module: string): Promise<AuditCard | undefined>;
}

export interface AuditModuleContext {
  readonly params: Promise<{ readonly module: string }>;
}

export type AuditListHandler = (request: Request) => Promise<Response>;
export type AuditModuleHandler = (
  request: Request,
  context: AuditModuleContext,
) => Promise<Response>;

const AWAITING_STATUSES: readonly AuditStatus[] = ["pending", "blocked"];

export function listAuditModules(registry: AuditRegistry): AuditListHandler {
  return async () => {
    const cards = await registry.list();
    return Response.json(
      cards.filter((card) => AWAITING_STATUSES.includes(card.status)),
    );
  };
}

export function getAuditModule(registry: AuditRegistry): AuditModuleHandler {
  return async (_request, context) => {
    const { module } = await context.params;
    const card = await registry.get(module);
    if (card === undefined) {
      return Response.json({ error: `unknown module '${module}'` }, { status: 404 });
    }
    return Response.json(card);
  };
}

export function createInMemoryAuditRegistry(
  cards: readonly AuditCard[],
): AuditRegistry {
  const byModule = new Map(cards.map((card) => [card.module, card]));
  return {
    async list() {
      return [...byModule.values()];
    },
    async get(module) {
      return byModule.get(module);
    },
  };
}
