import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Credentials } from "../application/ports";

const derive = promisify(scrypt);

export const nodeCredentials: Credentials = {
  async hashPassword(password) {
    const salt = randomBytes(16).toString("hex");
    const hash = (await derive(password, salt, 64)) as Buffer;
    return "s1:" + salt + ":" + hash.toString("hex");
  },
  async prepareVerification(password, digest) {
    const [, salt, expected] = (digest ?? "s1:invalid:").split(":");
    const hash = (await derive(password, salt, 64)) as Buffer;
    return () => digest !== undefined && timingSafeEqual(hash, Buffer.from(expected, "hex"));
  },
};
