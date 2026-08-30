import type { JsonObject, JsonValue } from "./types";

export class StrictJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StrictJsonError";
  }
}

const MAX_SAFE_INTEGER = 9_007_199_254_740_991;
const MAX_JSON_BYTES = 1024 * 1024;

class Parser {
  private index = 0;

  constructor(private readonly input: string) {}

  parse(): JsonValue {
    const value = this.parseValue(1);
    this.skipWhitespace();
    if (this.index !== this.input.length) {
      throw new StrictJsonError(`Trailing content at character ${this.index}.`);
    }
    return value;
  }

  private parseValue(depth: number): JsonValue {
    if (depth > 64) throw new StrictJsonError("JSON nesting exceeds 64 levels.");
    this.skipWhitespace();
    const next = this.input[this.index];
    if (next === "{") return this.parseObject(depth);
    if (next === "[") return this.parseArray(depth);
    if (next === '"') return this.parseString();
    if (next === "t") return this.consumeLiteral("true", true);
    if (next === "f") return this.consumeLiteral("false", false);
    if (next === "n") return this.consumeLiteral("null", null);
    if (next === "-" || (next !== undefined && next >= "0" && next <= "9")) {
      return this.parseInteger();
    }
    throw new StrictJsonError(`Unexpected token at character ${this.index}.`);
  }

  private parseObject(depth: number): JsonObject {
    this.index += 1;
    this.skipWhitespace();
    const output = Object.create(null) as JsonObject;
    if (this.take("}")) return output;
    while (true) {
      if (this.input[this.index] !== '"') {
        throw new StrictJsonError("Object keys must be strings.");
      }
      const key = this.parseString();
      if (Object.hasOwn(output, key)) {
        throw new StrictJsonError(`Duplicate object member: ${key}.`);
      }
      this.skipWhitespace();
      if (!this.take(":")) throw new StrictJsonError("Missing colon after object key.");
      output[key] = this.parseValue(depth + 1);
      this.skipWhitespace();
      if (this.take("}")) return output;
      if (!this.take(",")) throw new StrictJsonError("Missing comma in object.");
      this.skipWhitespace();
    }
  }

  private parseArray(depth: number): JsonValue[] {
    this.index += 1;
    this.skipWhitespace();
    const output: JsonValue[] = [];
    if (this.take("]")) return output;
    while (true) {
      output.push(this.parseValue(depth + 1));
      this.skipWhitespace();
      if (this.take("]")) return output;
      if (!this.take(",")) throw new StrictJsonError("Missing comma in array.");
    }
  }

  private parseString(): string {
    this.index += 1;
    let output = "";
    while (this.index < this.input.length) {
      const character = this.input[this.index]!;
      const code = this.input.charCodeAt(this.index);
      if (character === '"') {
        this.index += 1;
        return output;
      }
      if (character === "\\") {
        this.index += 1;
        const escaped = this.input[this.index++];
        const simple: Record<string, string> = {
          '"': '"',
          "\\": "\\",
          "/": "/",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t",
        };
        if (escaped !== undefined && Object.hasOwn(simple, escaped)) {
          output += simple[escaped];
          continue;
        }
        if (escaped !== "u") throw new StrictJsonError("Invalid string escape.");
        const first = this.readHexCodeUnit();
        if (first >= 0xd800 && first <= 0xdbff) {
          if (this.input.slice(this.index, this.index + 2) !== "\\u") {
            throw new StrictJsonError("Unpaired UTF-16 surrogate.");
          }
          this.index += 2;
          const second = this.readHexCodeUnit();
          if (second < 0xdc00 || second > 0xdfff) {
            throw new StrictJsonError("Unpaired UTF-16 surrogate.");
          }
          output += String.fromCharCode(first, second);
        } else {
          if (first >= 0xdc00 && first <= 0xdfff) {
            throw new StrictJsonError("Unpaired UTF-16 surrogate.");
          }
          output += String.fromCharCode(first);
        }
        continue;
      }
      if (code < 0x20) throw new StrictJsonError("Unescaped control character.");
      if (code >= 0xd800 && code <= 0xdbff) {
        const low = this.input.charCodeAt(this.index + 1);
        if (low < 0xdc00 || low > 0xdfff) {
          throw new StrictJsonError("Unpaired UTF-16 surrogate.");
        }
        output += character + this.input[this.index + 1]!;
        this.index += 2;
        continue;
      }
      if (code >= 0xdc00 && code <= 0xdfff) {
        throw new StrictJsonError("Unpaired UTF-16 surrogate.");
      }
      output += character;
      this.index += 1;
    }
    throw new StrictJsonError("JSON ended inside a string.");
  }

  private parseInteger(): number {
    const start = this.index;
    this.take("-");
    if (this.take("0")) {
      const next = this.input[this.index];
      if (next !== undefined && next >= "0" && next <= "9") {
        throw new StrictJsonError("Leading zero in number.");
      }
    } else {
      const first = this.input[this.index];
      if (first === undefined || first < "1" || first > "9") {
        throw new StrictJsonError("Invalid integer.");
      }
      while (true) {
        const next = this.input[this.index];
        if (next === undefined || next < "0" || next > "9") break;
        this.index += 1;
      }
    }
    const next = this.input[this.index];
    if (next === "." || next === "e" || next === "E") {
      throw new StrictJsonError(
        "Floating-point values require full RFC 8785 serialization and are refused.",
      );
    }
    const value = Number(this.input.slice(start, this.index));
    if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_SAFE_INTEGER) {
      throw new StrictJsonError("Integer is outside the interoperable safe range.");
    }
    return value;
  }

  private readHexCodeUnit(): number {
    const raw = this.input.slice(this.index, this.index + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(raw)) {
      throw new StrictJsonError("Invalid Unicode escape.");
    }
    this.index += 4;
    return Number.parseInt(raw, 16);
  }

  private consumeLiteral<T extends boolean | null>(text: string, value: T): T {
    if (this.input.slice(this.index, this.index + text.length) !== text) {
      throw new StrictJsonError(`Invalid literal at character ${this.index}.`);
    }
    this.index += text.length;
    return value;
  }

  private skipWhitespace(): void {
    while (
      this.index < this.input.length &&
      " \n\r\t".includes(this.input[this.index]!)
    ) {
      this.index += 1;
    }
  }

  private take(character: string): boolean {
    if (this.input[this.index] !== character) return false;
    this.index += 1;
    return true;
  }
}

export function strictParse(raw: string): JsonValue {
  if (utf8(raw).length > MAX_JSON_BYTES) {
    throw new StrictJsonError("JSON exceeds the 1 MiB RAPP limit.");
  }
  return new Parser(raw).parse();
}

export function canonicalize(value: JsonValue, depth = 1): string {
  if (depth > 64) throw new StrictJsonError("JSON nesting exceeds 64 levels.");
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new StrictJsonError("Canonical values support interoperable integers only.");
    }
    return String(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value === "string") {
    assertValidUnicode(value);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item, depth + 1)).join(",")}]`;
  }
  const keys = Object.keys(value);
  keys.forEach(assertValidUnicode);
  keys.sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key]!, depth + 1)}`)
    .join(",")}}`;
}

export function domainHash(domain: string, value: JsonValue): string {
  if (!/^[\x00-\x7f]*$/.test(domain)) {
    throw new StrictJsonError("Hash domain must be ASCII.");
  }
  return sha256(utf8(`${domain}\n${canonicalize(value)}`));
}

export function sha256(bytes: number[]): string {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const data = [...bytes];
  const bitLength = data.length * 8;
  data.push(0x80);
  while (data.length % 64 !== 56) data.push(0);
  const high = Math.floor(bitLength / 0x1_0000_0000);
  const low = bitLength >>> 0;
  data.push(
    (high >>> 24) & 255,
    (high >>> 16) & 255,
    (high >>> 8) & 255,
    high & 255,
    (low >>> 24) & 255,
    (low >>> 16) & 255,
    (low >>> 8) & 255,
    low & 255,
  );
  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ];
  const words = new Array<number>(64);
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const at = offset + index * 4;
      words[index] =
        ((data[at]! << 24) |
          (data[at + 1]! << 16) |
          (data[at + 2]! << 8) |
          data[at + 3]!) >>>
        0;
    }
    for (let index = 16; index < 64; index += 1) {
      const x = words[index - 15]!;
      const y = words[index - 2]!;
      const s0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const s1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      words[index] =
        (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + constants[index]! + words[index]!) >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0]! + a) >>> 0;
    hash[1] = (hash[1]! + b) >>> 0;
    hash[2] = (hash[2]! + c) >>> 0;
    hash[3] = (hash[3]! + d) >>> 0;
    hash[4] = (hash[4]! + e) >>> 0;
    hash[5] = (hash[5]! + f) >>> 0;
    hash[6] = (hash[6]! + g) >>> 0;
    hash[7] = (hash[7]! + h) >>> 0;
  }
  return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
}

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

function utf8(value: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (low < 0xdc00 || low > 0xdfff) {
        throw new StrictJsonError("Unpaired UTF-16 surrogate.");
      }
      code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new StrictJsonError("Unpaired UTF-16 surrogate.");
    }
    if (code <= 0x7f) bytes.push(code);
    else if (code <= 0x7ff) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code <= 0xffff) {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

function assertValidUnicode(value: string): void {
  utf8(value);
}
