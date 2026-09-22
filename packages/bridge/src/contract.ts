import { XzContractError } from "./errors.js";

export interface ContractDescriptor {
  readonly library: string;
  readonly symbol: string;
  readonly okCode: number;
  readonly errorNames?: Readonly<Record<number, string>>;
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