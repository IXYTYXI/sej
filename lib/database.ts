export type DatabaseValue = string | number | null;
export type RunResult = { meta: { changes: number } };

export interface PreparedStatement {
  bind(...values: DatabaseValue[]): PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<RunResult>;
}

/** The subset used by the learning and AI services; batches are atomic. */
export interface Database {
  prepare(sql: string): PreparedStatement;
  batch(statements: PreparedStatement[]): Promise<RunResult[]>;
}
