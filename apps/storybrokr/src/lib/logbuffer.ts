export class LogBuffer {
  private readonly buf: string[] = [];
  private partial = '';
  private readonly listeners = new Set<(line: string) => void>();

  constructor(private readonly capacity = 2000) {}

  get lines(): readonly string[] {
    return this.buf;
  }

  push(chunk: string): void {
    const text = this.partial + chunk;
    const parts = text.split('\n');
    this.partial = parts.pop() ?? '';
    for (const line of parts) {
      this.buf.push(line);
      if (this.buf.length > this.capacity) this.buf.shift();
      for (const cb of this.listeners) cb(line);
    }
  }

  tail(n: number): string[] {
    return this.buf.slice(Math.max(0, this.buf.length - n));
  }

  onLine(cb: (line: string) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}
