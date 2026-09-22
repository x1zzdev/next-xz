declare module "koffi" {
  export interface KoffiSignature {
    readonly ret: string;
    readonly args: readonly string[];
  }

  export interface KoffiLibrary {
    func(signature: KoffiSignature): (...args: unknown[]) => unknown;
    close?(): void;
  }

  export function load(path: string): KoffiLibrary;
}