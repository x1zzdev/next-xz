import { BridgeRuntimeError, XzContractError } from "./errors.js";
import { asXzInt } from "./marshalling.js";

export interface ContractDescriptor {
  readonly library: string;
  readonly symbol: string;
  readonly okCode: number;
  readonly errorNames?: Readonly<Record<number, string>>;
}

/**
 * Normalizes a contracted symbol's `Int`/`usize` status return to the `number`
 * a `ContractDescriptor` compares against. The status is a small ABI code, but
 * it still crosses as an exact `bigint`; a value outside the safe integer range
 * is a hard error rather than a lossy `number` cast.
 */
export function asStatusCode(value: unknown): number {
  const code = asXzInt(value);
  if (code > BigInt(Number.MAX_SAFE_INTEGER) || code < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new BridgeRuntimeError(`contract status code ${code}n is outside the safe integer range`);
  }
  return Number(code);
}

export function runContracted<T>(
  descriptor: ContractDescriptor,
  invoke: () => number,
  readValue: () => T,
): T {
  const status = invoke();
  if (status === descriptor.okCode) {
    return readValue();
  }
  throw new XzContractError(
    descriptor.library,
    descriptor.symbol,
    status,
    descriptor.errorNames?.[status],
  );
}