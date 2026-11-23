/** Warehouse UI actions currently exposed as session capabilities. */
export const SESSION_PERMISSIONS = ["read", "warehouse", "warehouse.status", "warehouse.reparent", "warehouse.reassign"] as const;
export type SessionPermission = typeof SESSION_PERMISSIONS[number];
export interface SessionCapabilities {
  authenticated: boolean;
  permissions: readonly SessionPermission[];
}
