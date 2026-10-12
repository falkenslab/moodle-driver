// Small files the activity checks upload, made in a temporary folder: text files, and a SCORM 1.2
// package zipped here (stored, no compression), whose one SCO reports itself completed.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after } from "node:test";

const dir = mkdtempSync(path.join(tmpdir(), "sandbox-files-"));
after(() => rmSync(dir, { recursive: true, force: true }));

/** A local text file, by name, with the text given: its absolute path. */
export function textFile(name: string, text = `${name}\n`): string {
  const file = path.join(dir, name);
  writeFileSync(file, text);
  return file;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A zip of `entries` (name → content), stored without compression. */
export function zip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content, "utf8");
    const fileName = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, fileName, data);
    centrals.push(central, fileName);
    offset += local.length + fileName.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="driver-check" version="1"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="org">
    <organization identifier="org">
      <title>Driver check</title>
      <item identifier="item1" identifierref="res1"><title>Only lesson</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="res1" type="webcontent" adlcp:scormtype="sco" href="index.html"><file href="index.html"/></resource>
  </resources>
</manifest>
`;

// The SCO finds Moodle's API in its parent, as SCORM 1.2 says, and reports itself completed.
const SCO = `<!doctype html>
<html><head><title>Only lesson</title></head>
<body><p>Driver check SCO</p>
<script>
  var api = null, w = window;
  for (var i = 0; i < 10 && w; i++) { if (w.API) { api = w.API; break; } if (w === w.parent) break; w = w.parent; }
  if (api) {
    api.LMSInitialize("");
    api.LMSSetValue("cmi.core.lesson_status", "completed");
    api.LMSSetValue("cmi.core.score.raw", "80");
    api.LMSCommit("");
    document.body.setAttribute("data-reported", "yes");
  }
</script>
</body></html>
`;

/** A SCORM 1.2 package with one SCO that reports itself completed with a score of 80: its path. */
export function scormPackage(name = "driver-check-scorm.zip"): string {
  const file = path.join(dir, name);
  writeFileSync(file, zip({ "imsmanifest.xml": MANIFEST, "index.html": SCO }));
  return file;
}

/** Downloads a file of the site (no session needed) into the temporary folder: its path, or undefined when the site doesn't serve it. */
export async function siteFile(url: string, name: string): Promise<string | undefined> {
  const response = await fetch(url);
  if (!response.ok) return undefined;
  const file = path.join(dir, name);
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  return file;
}
