import { app, dialog } from "electron";
import { join } from "node:path";
import { z } from "zod";
import type Database from "better-sqlite3";
import type { Identity } from "@core/identity/application/identity";
import { snapshot, stageRestore, activeDirectory, activate } from "../recovery";
import { bind } from "./dispatch";

export function registerRecoveryHandlers(db: Database.Database, identity: Identity) {
  for (const action of ["backup", "restore"] as const) {
    bind("recovery:" + action, z.undefined(), async (_, w) => {
      const actor = identity.actor(w);
      identity.authorize(actor, action);
      const folder = await dialog.showOpenDialog({
        properties: ["openDirectory"],
      });
      if (folder.canceled) return null;
      if (identity.actor(w) !== actor) throw Error("Session changed");
      identity.authorize(actor, action);
      const root = app.getPath("userData");
      const live = activeDirectory(root);
      if (action === "backup") {
        const path = snapshot(db, live, folder.filePaths[0]);
        db.prepare("INSERT INTO audit(actor,action,target) VALUES(?,'backup',?)").run(actor, path);
        return path;
      }
      const id = stageRestore(folder.filePaths[0], root);
      snapshot(db, live, join(root, "backups"));
      db.prepare("INSERT INTO audit(actor,action,target) VALUES(?,'restore',?)").run(actor, id);
      activate(root, id);
      app.relaunch();
      app.exit(0);
      return null;
    });
  }
}
