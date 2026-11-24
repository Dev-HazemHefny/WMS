export interface OperatorCredentials {
  id: string;
  digest: string;
}

export interface NewOperator extends OperatorCredentials {
  name: string;
}

export interface OperatorStore {
  findByName(name: string): OperatorCredentials | undefined;
  hasOperators(): boolean;
  hasPermission(operator: string, action: string): boolean;
  listPermissions(operator: string): readonly string[];
  // Check for an empty store and write the first operator and role atomically.
  createFirstOperator(operator: NewOperator, role: string): boolean;
  // Persist the operator, its roles and the add-user audit entry atomically.
  createOperator(operator: NewOperator, roles: readonly string[], actor: string): void;
}

export interface Credentials {
  hashPassword(password: string): Promise<string>;
  // Derive even for a missing operator. Compare only after Application checks the attempt.
  prepareVerification(password: string, digest: string | undefined): Promise<() => boolean>;
}
