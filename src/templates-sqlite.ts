/** SQLite persistify adapter template (default until the user supplies their own). */

export function genSqliteAdapter(): string {
  return `import sqlite3 from "sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { FieldInfo, PersistenceAdapter } from "persistify-openapi";

function resolveDbPath(input: string): string {
  const stripped = input.startsWith("projectRoot://")
    ? input.slice("projectRoot://".length)
    : input;
  // projectRoot:// is defined as process.cwd() where package.json lives
  return path.isAbsolute(stripped) ? stripped : path.join(process.cwd(), stripped);
}

function qIdent(name: string): string {
  return \`"\${name.replace(/"/g, '""')}"\`;
}

function fieldToSqlType(field: FieldInfo): string {
  const t = (field.type || "").toLowerCase();
  if (t === "integer") return "INTEGER";
  if (t === "number") return "REAL";
  if (t === "boolean") return "INTEGER";
  // string covers uuid, date-time, uri, enum, etc.
  return "TEXT";
}

function sqliteTypeToFieldInfo(sqlType: string): string {
  const t = (sqlType || "").toUpperCase();
  if (t.includes("INT")) return "integer";
  if (t.includes("REAL") || t.includes("FLOA") || t.includes("DOUB")) return "number";
  if (t.includes("BOOL")) return "boolean";
  return "string";
}

function toSqlValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (Array.isArray(value)) {
    return String(value);
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("id" in obj && typeof obj.id === "string") return obj.id;
    if ("id" in obj && typeof obj.id === "number") return obj.id;
    return String(value);
  }
  return value;
}

export class SQLiteAdapter implements PersistenceAdapter {
  private db!: sqlite3.Database;
  private ready: Promise<void>;

  constructor(dbPath: string = "projectRoot://var/db/app.db") {
    const fullPath = resolveDbPath(dbPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    this.ready = new Promise<void>((resolve, reject) => {
      const db = new sqlite3.Database(fullPath, (err) => {
        if (err) reject(err);
        else resolve();
      });
      this.db = db;
    });
    this.ready.then(
      () =>
        new Promise<void>((resolve) => {
          this.db.exec("PRAGMA journal_mode=WAL;", () => resolve());
        })
    );
  }

  private async ensureReady(): Promise<void> {
    await this.ready;
  }

  private run(sql: string, params: unknown[] = []): Promise<sqlite3.RunResult> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params as any[], function (err: Error | null) {
        if (err) reject(err);
        else resolve(this);
      });
    });
  }

  private get(sql: string, params: unknown[] = []): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params as any[], (err: Error | null, row: unknown) => {
        if (err) reject(err);
        else resolve(row ?? null);
      });
    });
  }

  private all(sql: string, params: unknown[] = []): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params as any[], (err: Error | null, rows: unknown[]) => {
        if (err) reject(err);
        else resolve(rows ?? []);
      });
    });
  }

  private exec(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.exec(sql, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private buildWhere(where?: Record<string, any>): { clause: string; params: unknown[] } {
    if (!where || Object.keys(where).length === 0) return { clause: "", params: [] };
    const keys = Object.keys(where);
    const clause = " WHERE " + keys.map((k) => \`\${qIdent(k)} = ?\`).join(" AND ");
    const params = keys.map((k) => toSqlValue(where[k]));
    return { clause, params };
  }

  async createTable(collectionName: string, fields: Record<string, FieldInfo>): Promise<void> {
    await this.ensureReady();
    const cols = Object.entries(fields).map(([name, info]) => {
      const sqlType = fieldToSqlType(info);
      const notNull = info.required ? " NOT NULL" : "";
      const pk = name === "id" ? " PRIMARY KEY" : "";
      return \`\${qIdent(name)} \${sqlType}\${pk}\${notNull}\`;
    });
    const colDef = cols.length > 0 ? cols.join(", ") : \`\${qIdent("id")} TEXT PRIMARY KEY\`;
    const sql = \`CREATE TABLE IF NOT EXISTS \${qIdent(collectionName)} (\${colDef});\`;
    await this.exec(sql);
  }

  async updateTable(collectionName: string, fields: Record<string, FieldInfo>): Promise<void> {
    await this.ensureReady();
    const existing = await this.getTableFields(collectionName);
    for (const [name, info] of Object.entries(fields)) {
      if (name in existing) continue;
      const sqlType = fieldToSqlType(info);
      const sql = \`ALTER TABLE \${qIdent(collectionName)} ADD COLUMN \${qIdent(name)} \${sqlType};\`;
      try {
        await this.exec(sql);
      } catch (e) {
        const msg = String(e);
        if (!msg.includes("duplicate column")) throw e;
      }
    }
  }

  async getTableFields(collectionName: string): Promise<Record<string, FieldInfo>> {
    await this.ensureReady();
    const rows = (await this.all(\`PRAGMA table_info(\${qIdent(collectionName)});\`)) as Array<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: unknown;
      pk: number;
    }>;
    if (!rows || rows.length === 0) return {};
    const out: Record<string, FieldInfo> = {};
    for (const r of rows) {
      out[r.name] = {
        type: sqliteTypeToFieldInfo(r.type),
        required: r.notnull === 1 || r.pk === 1,
      } as FieldInfo;
    }
    return out;
  }

  async insertOne<T>(collectionName: string, data: T): Promise<T> {
    await this.ensureReady();
    const obj = data as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) throw new Error("insertOne: data is empty");
    const cols = keys.map(qIdent).join(", ");
    const placeholders = keys.map(() => "?").join(", ");
    const values = keys.map((k) => toSqlValue(obj[k]));
    const sql = \`INSERT INTO \${qIdent(collectionName)} (\${cols}) VALUES (\${placeholders});\`;
    const res = await this.run(sql, values);
    // Return DB truth so auto ids (INTEGER PRIMARY KEY) come back to the caller.
    try {
      const lastID = (res as unknown as { lastID?: unknown }).lastID;
      if (typeof lastID === "number") {
        const row = await this.get(
          \`SELECT * FROM \${qIdent(collectionName)} WHERE rowid = ? LIMIT 1;\`,
          [lastID]
        );
        if (row) return row as T;
      }
    } catch {
      // fall through to echoing the input
    }
    return data;
  }

  async insertMany<T>(collectionName: string, data: T[]): Promise<T[]> {
    await this.ensureReady();
    const out: T[] = [];
    for (const item of data) {
      out.push(await this.insertOne(collectionName, item));
    }
    return out;
  }

  async getOne<T>(collectionName: string, where: Record<string, any>): Promise<T | null> {
    await this.ensureReady();
    const { clause, params } = this.buildWhere(where);
    const sql = \`SELECT * FROM \${qIdent(collectionName)}\${clause} LIMIT 1;\`;
    const row = await this.get(sql, params);
    return (row as T | null) ?? null;
  }

  async getMany<T>(collectionName: string, where?: Record<string, any>): Promise<T[]> {
    await this.ensureReady();
    const { clause, params } = this.buildWhere(where);
    const sql = \`SELECT * FROM \${qIdent(collectionName)}\${clause};\`;
    const rows = await this.all(sql, params);
    return rows as T[];
  }

  async updateOne<T>(collectionName: string, data: Partial<T>, where: Record<string, any>): Promise<T> {
    await this.ensureReady();
    const patch = data as Record<string, unknown>;
    const setKeys = Object.keys(patch);
    if (setKeys.length === 0) {
      const existing = await this.getOne<T>(collectionName, where);
      if (!existing) throw new Error(\`updateOne: not found where \${JSON.stringify(where)}\`);
      return existing;
    }
    const setClause = setKeys.map((k) => \`\${qIdent(k)} = ?\`).join(", ");
    const setParams = setKeys.map((k) => toSqlValue(patch[k]));
    const { clause: whereClause, params: whereParams } = this.buildWhere(where);
    if (!whereClause) throw new Error("updateOne requires where clause");
    const sql = \`UPDATE \${qIdent(collectionName)} SET \${setClause}\${whereClause};\`;
    await this.run(sql, [...setParams, ...whereParams]);
    const updated = await this.getOne<T>(collectionName, where);
    if (!updated) return { ...(patch as unknown as T) } as T;
    return updated;
  }

  async updateMany<T>(collectionName: string, data: Partial<T>, where: Record<string, any>): Promise<T[]> {
    await this.ensureReady();
    const matches = await this.getMany<T>(collectionName, where);
    if (matches.length === 0) return [];
    const results: T[] = [];
    for (const row of matches) {
      const r = row as Record<string, unknown>;
      const entityWhere: Record<string, unknown> = { ...where };
      if (r.id !== undefined) entityWhere["id"] = r.id;
      results.push(await this.updateOne<T>(collectionName, data, entityWhere as Record<string, any>));
    }
    return results;
  }

  async deleteOne(collectionName: string, where: Record<string, any>): Promise<void> {
    await this.ensureReady();
    const { clause, params } = this.buildWhere(where);
    if (!clause) throw new Error("deleteOne requires where clause");
    const sql = \`DELETE FROM \${qIdent(collectionName)}\${clause};\`;
    await this.run(sql, params);
  }

  async deleteMany(collectionName: string, where: Record<string, any>): Promise<void | number> {
    await this.ensureReady();
    const { clause, params } = this.buildWhere(where);
    if (!where || Object.keys(where).length === 0) {
      const res = await this.run(\`DELETE FROM \${qIdent(collectionName)};\`, []);
      return (res as any).changes ?? 0;
    }
    const sql = \`DELETE FROM \${qIdent(collectionName)}\${clause};\`;
    const res = await this.run(sql, params);
    return (res as any).changes ?? 0;
  }
}
`;
}
