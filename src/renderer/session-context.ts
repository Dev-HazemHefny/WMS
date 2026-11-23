import { createContext, useContext } from "react";
import type { SessionCapabilities, SessionPermission } from "../shared/identity/types";

export interface SessionState {
  capabilities: SessionCapabilities;
  refreshCapabilities: () => Promise<void>;
}
export const SessionContext = createContext<SessionState | null>(null);
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("Session provider is required");
  return { ...value, can: (permission: SessionPermission) => value.capabilities.authenticated && value.capabilities.permissions.includes(permission) };
}
