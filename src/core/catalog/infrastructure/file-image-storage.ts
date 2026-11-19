import { mkdirSync, readFileSync, unlinkSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ImageStorage } from "../application/ports";

const ALLOWED_FOLDERS = new Set(["products", "brands"]);

const EXTENSION_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp"
};

function sanitizeFolder(folder: string): string {
  if (!ALLOWED_FOLDERS.has(folder)) {
    throw new Error(`مجلد الصورة غير مسموح: ${folder}`);
  }
  return folder;
}

function sanitizeFileName(fileName: string): string {
  const base = fileName.replace(/\\/g, "/").split("/").pop() ?? "";
  if (!base || base === "." || base === "..") {
    throw new Error("اسم ملف الصورة غير صالح");
  }
  if (base.includes("\0")) {
    throw new Error("اسم ملف الصورة غير صالح");
  }
  return base;
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return "";
  return fileName.slice(dot + 1).toLowerCase();
}

function dataUrlToBuffer(dataUrl: string): { mime: string; buffer: Buffer } {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) {
    throw new Error("صيغة الصورة غير مدعومة. استخدم PNG أو JPEG أو WEBP");
  }
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 1_500_000) {
    throw new Error("حجم الصورة يتجاوز 1.5 ميجابايت");
  }
  return { mime: EXTENSION_TO_MIME[match[1]] ?? "image/jpeg", buffer };
}

export class FileImageStorage implements ImageStorage {
  constructor(private readonly baseDir: string) {}

  private resolvePath(folder: string, fileName: string): string {
    return join(this.baseDir, sanitizeFolder(folder), sanitizeFileName(fileName));
  }

  save(input: { dataUrl: string; folder: string; fileName: string }): string {
    const { buffer } = dataUrlToBuffer(input.dataUrl);
    const dir = join(this.baseDir, sanitizeFolder(input.folder));
    mkdirSync(dir, { recursive: true });
    const fileName = sanitizeFileName(input.fileName);
    const filePath = join(dir, fileName);
    writeFileSync(filePath, buffer);
    return `${input.folder}/${fileName}`;
  }

  read(relativePath: string): string | null {
    const [folder, ...rest] = relativePath.split("/");
    const fileName = rest.join("/");
    if (!folder || !fileName) return null;
    if (!ALLOWED_FOLDERS.has(folder)) return null;
    const filePath = this.resolvePath(folder, fileName);
    if (!existsSync(filePath)) return null;
    let buffer: Buffer;
    try {
      buffer = readFileSync(filePath);
    } catch {
      return null;
    }
    const ext = extensionOf(fileName);
    const mime = EXTENSION_TO_MIME[ext] ?? "application/octet-stream";
    return `data:${mime};base64,${buffer.toString("base64")}`;
  }

  remove(relativePath: string): void {
    const [folder, ...rest] = relativePath.split("/");
    const fileName = rest.join("/");
    if (!folder || !fileName) return;
    if (!ALLOWED_FOLDERS.has(folder)) return;
    const filePath = this.resolvePath(folder, fileName);
    if (!existsSync(filePath)) return;
    try {
      unlinkSync(filePath);
    } catch {
      // best effort removal; ignore missing or locked files
    }
  }
}
