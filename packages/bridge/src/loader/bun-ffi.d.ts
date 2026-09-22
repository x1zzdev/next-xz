declare module "bun:ffi" {
  export const FFIType: Readonly<Record<string, number>>;

  export function dlopen(
    path: string,
    symbols: Record<string, { args?: readonly number[]; returns?: number }>,
  ): { symbols: Record<string, unknown>; close(): void };
}
