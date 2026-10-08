// Minimal localStorage shim so the board modules can run under plain Node.
// Import for the side effect before any module that touches storage.

class MemoryStorage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
}

const g = globalThis as unknown as { localStorage?: MemoryStorage };
if (!g.localStorage) g.localStorage = new MemoryStorage();

export const storage = g.localStorage;

/** Reset between test cases. */
export function resetStorage(): void {
  storage.clear();
}

let passed = 0;
let failed = 0;

export function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name} ${extra}`);
  }
}

export function report(): never {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
