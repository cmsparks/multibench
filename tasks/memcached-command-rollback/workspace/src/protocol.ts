export type Item = {
  key: string;
  flags: number;
  exptime: number;
  value: string;
  cas: number;
};

export class MemcachedProtocol {
  readonly #items = new Map<string, Item>();
  #nextCas = 1;

  execute(input: string): string {
    const [command = "", ...parts] = input.trim().split(/\s+/);
    const normalizedCommand = command.toUpperCase();

    if (normalizedCommand === "SET") {
      const [key, flags, exptime, ...valueParts] = parts;
      if (!key || flags === undefined || exptime === undefined || valueParts.length === 0) {
        return "CLIENT_ERROR bad command line format";
      }
      const value = valueParts.join(" ");
      this.#items.set(key, {
        key,
        flags: Number(flags),
        exptime: Number(exptime),
        value,
        cas: this.#nextCas,
      });
      this.#nextCas += 1;
      return "STORED";
    }

    if (normalizedCommand === "GET") {
      const item = this.#items.get(parts[0] ?? "");
      if (!item) {
        return "END";
      }
      return `VALUE ${item.key} ${item.flags} ${item.value.length}\n${item.value}\nEND`;
    }

    if (normalizedCommand === "META") {
      const item = this.#items.get(parts[0] ?? "");
      if (!item) {
        return "NOT_FOUND";
      }
      return `META ${item.key} flags=${item.flags} bytes=${item.value.length} exptime=${item.exptime} cas=${item.cas}`;
    }

    if (normalizedCommand === "TOUCH") {
      const [key, exptime] = parts;
      const item = this.#items.get(key ?? "");
      if (!item || exptime === undefined) {
        return "NOT_FOUND";
      }
      item.exptime = Number(exptime);
      item.cas = this.#nextCas;
      this.#nextCas += 1;
      return "TOUCHED";
    }

    return "ERROR";
  }
}

export function createProtocol(): MemcachedProtocol {
  return new MemcachedProtocol();
}
