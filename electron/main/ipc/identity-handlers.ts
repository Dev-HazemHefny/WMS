import { z } from "zod";
import type { Identity } from "@core/identity/public";
import { registerScope } from "./dispatch";

export function registerIdentityHandlers(identity: Identity) {
  return registerScope(({ bind, own }) => {
    const pending = new Map<Promise<unknown>, number>();
    own(() => {
      for (const window of new Set(pending.values())) identity.end(window);
    });

    async function track<T>(window: number, operation: Promise<T>): Promise<T> {
      pending.set(operation, window);
      try {
        return await operation;
      } finally {
        pending.delete(operation);
      }
    }

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
      (i, w) => track(w, identity.login(w, i.name, i.password, i.setup)),
    );
    bind(
      "identity:add",
      z.object({
        name: z.string().trim().min(1).max(120),
        password: z.string().min(12).max(256),
        roles: z.array(z.enum(["admin", "clerk", "supervisor"])).min(1),
      }),
      (i, w) => track(w, identity.addOperator(w, i.name, i.password, i.roles)),
    );
    bind("identity:logout", z.undefined(), (_, w) => identity.end(w));
  });
}
