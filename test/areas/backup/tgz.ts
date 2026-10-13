// A gzipped tar written from entries, for tests that make or change backup files: ustar headers, a
// long name in the prefix field as Moodle's packer writes it.
import { gunzipSync, gzipSync } from "node:zlib";

function header(name: string, size: number): Buffer {
  const block = Buffer.alloc(512);
  let prefix = "";
  let base = name;
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf("/", 155);
    prefix = name.slice(0, cut);
    base = name.slice(cut + 1);
  }
  block.write(base, 0, 100, "utf8");
  block.write("0000644\0", 100, "latin1");
  block.write("0000000\0", 108, "latin1");
  block.write("0000000\0", 116, "latin1");
  block.write(`${size.toString(8).padStart(11, "0")}\0`, 124, "latin1");
  block.write("00000000000\0", 136, "latin1");
  block.write("        ", 148, "latin1");
  block.write("0", 156, "latin1");
  block.write("ustar\0", 257, "latin1");
  block.write("00", 263, "latin1");
  block.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "latin1");
  return block;
}

/** A .tar.gz of `entries` (name to content), in order. */
export function writeTgz(entries: [string, string | Buffer][]): Buffer {
  const parts: Buffer[] = [];
  for (const [name, content] of entries) {
    const data = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    parts.push(header(name, data.length), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}

/** The entries of a .tar.gz written by Moodle or `writeTgz` (plain ustar files only), in order. */
export function readTgz(tgz: Buffer): [string, Buffer][] {
  const tar = gunzipSync(tgz);
  const entries: [string, Buffer][] = [];
  for (let at = 0; at + 512 <= tar.length; ) {
    const block = tar.subarray(at, at + 512);
    if (block.every((byte) => byte === 0)) break;
    const text = (from: number, length: number) => block.subarray(from, from + length).toString("utf8").replace(/\0[\s\S]*$/, "");
    const name = [text(345, 155), text(0, 100)].filter(Boolean).join("/");
    const size = parseInt(text(124, 12).trim() || "0", 8);
    if (String.fromCharCode(block[156]!) !== "5") entries.push([name, Buffer.from(tar.subarray(at + 512, at + 512 + size))]);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}
