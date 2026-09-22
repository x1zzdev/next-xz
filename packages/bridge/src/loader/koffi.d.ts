declare module "koffi" {
  export interface KoffiSignature {
    readonly ret: string | object;
    readonly args: readonly (string | object)[];
  }

  export interface KoffiLibrary {
    func(signature: KoffiSignature): (...args: unknown[]) => unknown;
    close?(): void;
  }

  export function load(path: string): KoffiLibrary;

  export function struct(name: string, fields: Readonly<Record<string, string | object>>): object;
}