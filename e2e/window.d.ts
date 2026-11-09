// The test hooks src/main.ts puts on window, loosely typed for the specs, and the helpers specs leave on it.
interface Window {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  BR: any;
  hook(): { reeling: boolean; nibbles: number };
  step(): void;
  __lines: string[];
  miniRead(): { wrong: number; paper: number };
  __restoreStorage(): void;
  __restoreGraphics(): void;
}
