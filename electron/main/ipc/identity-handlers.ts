import { z } from "zod";
import type { Identity } from "@core/identity/application/identity";
import { bind } from "./dispatch";

export function registerIdentityHandlers(identity: Identity) {
  bind("identity:setup", z.undefined(), () => identity.needsAdmin());
  bind(
    "identity:login",
    z
      .object({
        name: z.string().trim().min(1).max(120),
        password: z.string().min(1).max(256),
        setup: z.boolean(),
      })
      .refine(
        (i) => !i.setup || i.password.length >= 12,
        "استخدم 12 حرفًا على الأقل",
      ),
    (i, w) => identity.login(w, i.name, i.password, i.setup),
  );
  bind(
    "identity:add",
    z.object({
      name: z.string().trim().min(1).max(120),
      password: z.string().min(12).max(256),
      roles: z.array(z.enum(["admin", "clerk", "supervisor"])).min(1),
    }),
    (i, w) => identity.addOperator(w, i.name, i.password, i.roles),
  );
  bind("identity:logout", z.undefined(), (_, w) => identity.end(w));
}
