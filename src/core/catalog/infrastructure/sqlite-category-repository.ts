import type { Category, Page, PageQuery } from "../../../shared/catalog/types";
import type { CategoryRepository } from "../domain/repositories";
import { likeTerm, pageClause, readCount, rethrowDb, type SqlDatabase } from "./sql";

interface CategoryRow {
  id: string;
  name: string;
  code: string;
  description: string | null;
  parent_id: string | null;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
}

function mapCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    parentId: row.parent_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class SqliteCategoryRepository implements CategoryRepository {
  constructor(private readonly db: SqlDatabase) {}

  insert(category: Category): void {
    try {
      this.db.prepare(`INSERT INTO categories
        (id, name, code, description, parent_id, status, created_at, updated_at)
        VALUES (@id, @name, @code, @description, @parentId, @status, @createdAt, @updatedAt)`).run(category);
    } catch (error) {
      rethrowDb(error);
    }
  }

  update(category: Category): void {
    try {
      this.db.prepare(`UPDATE categories
        SET name=@name, code=@code, description=@description, parent_id=@parentId, status=@status, updated_at=@updatedAt
        WHERE id=@id`).run(category);
    } catch (error) {
      rethrowDb(error);
    }
  }

  delete(id: string): void {
    try {
      this.db.prepare("DELETE FROM categories WHERE id = ?").run(id);
    } catch (error) {
      rethrowDb(error);
    }
  }

  findById(id: string): Category | null {
    const row = this.db.prepare("SELECT * FROM categories WHERE id = ?").get(id) as CategoryRow | undefined;
    return row ? mapCategory(row) : null;
  }

  findByCode(code: string): Category | null {
    const row = this.db.prepare("SELECT * FROM categories WHERE code = ?").get(code) as CategoryRow | undefined;
    return row ? mapCategory(row) : null;
  }

  list(query: PageQuery): Page<Category> {
    const term = likeTerm(query.search);
    const filters = `WHERE (? IS NULL OR name LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\' OR IFNULL(description,'') LIKE ? ESCAPE '\\')
      AND (? IS NULL OR status = ?)`;
    const params = [term, term, term, term, query.status ?? null, query.status ?? null];
    const total = readCount(this.db, `SELECT COUNT(*) AS total FROM categories ${filters}`, params);
    const { limit, offset } = pageClause(query.page, query.pageSize);
    const rows = this.db.prepare(`SELECT * FROM categories ${filters} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?`).all(...params, limit, offset) as CategoryRow[];
    return { items: rows.map(mapCategory), total, page: query.page, pageSize: query.pageSize };
  }

  listAll(): Category[] {
    const rows = this.db.prepare("SELECT * FROM categories ORDER BY name COLLATE NOCASE").all() as CategoryRow[];
    return rows.map(mapCategory);
  }

  countProducts(id: string): number {
    return readCount(this.db, "SELECT COUNT(*) AS total FROM products WHERE category_id = ?", [id]);
  }

  countChildren(id: string): number {
    return readCount(this.db, "SELECT COUNT(*) AS total FROM categories WHERE parent_id = ?", [id]);
  }
}
