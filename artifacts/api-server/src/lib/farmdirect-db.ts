import { pool } from "@workspace/db";
import bcrypt from "bcryptjs";

type QueryOutput = { rows: unknown[]; rowCount: number | null };
type QueryFunction = (sql: string, values: unknown[]) => Promise<QueryOutput>;
type RunResult = { lastInsertRowid: number | undefined; changes: number };

export type FarmDirectDbSession = {
  one: <T>(sql: string, ...values: unknown[]) => Promise<T | undefined>;
  many: <T>(sql: string, ...values: unknown[]) => Promise<T[]>;
  run: (sql: string, ...values: unknown[]) => Promise<RunResult>;
};

function postgresSql(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function createSession(query: QueryFunction): FarmDirectDbSession {
  return {
    async one<T>(sql: string, ...values: unknown[]): Promise<T | undefined> {
      const result = await query(postgresSql(sql), values);
      return result.rows[0] as T | undefined;
    },
    async many<T>(sql: string, ...values: unknown[]): Promise<T[]> {
      const result = await query(postgresSql(sql), values);
      return result.rows as T[];
    },
    async run(sql: string, ...values: unknown[]): Promise<RunResult> {
      const statement = postgresSql(sql);
      const insertStatement =
        /^\s*INSERT\b/i.test(statement) && !/\bRETURNING\b/i.test(statement)
          ? `${statement.trim().replace(/;$/, "")} RETURNING id`
          : statement;
      const result = await query(insertStatement, values);
      const inserted = result.rows[0] as { id?: number } | undefined;
      return {
        lastInsertRowid: inserted?.id,
        changes: result.rowCount ?? 0,
      };
    },
  };
}

const rootSession = createSession(async (sql, values) => {
  const result = await pool.query(sql, values as never[]);
  return { rows: result.rows, rowCount: result.rowCount };
});

export const one = rootSession.one;
export const many = rootSession.many;
export const run = rootSession.run;

export async function withTransaction<T>(
  callback: (transaction: FarmDirectDbSession) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const transaction = createSession(async (sql, values) => {
      const result = await client.query(sql, values as never[]);
      return { rows: result.rows, rowCount: result.rowCount };
    });
    const result = await callback(transaction);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export type UserRole = "farmer" | "buyer" | "business" | "admin";
export type UserRow = {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  location: string;
  verified: number;
  organization: string | null;
  created_at: string;
};
export type ProductRow = {
  id: number;
  name: string;
  category: string;
  price: number;
  quantity: number;
  unit: string;
  location: string;
  description: string;
  image_url: string;
  farmer_id: number;
  farmer_name: string;
  verified_farmer: number;
  rating: number;
  review_count: number;
  min_bulk_quantity: number;
  featured: number;
};
export type OrderRow = {
  id: number;
  buyer_id: number;
  buyer_name: string;
  status: string;
  delivery_address: string;
  payment_method: string;
  total: number;
  created_at: string;
};

export function one<T>(sql: string, ...values: unknown[]): T | undefined {
  return database.prepare(sql).get(...(values as never[])) as T | undefined;
}

export function many<T>(sql: string, ...values: unknown[]): T[] {
  return database.prepare(sql).all(...(values as never[])) as T[];
}

export function run(sql: string, ...values: unknown[]) {
  return database.prepare(sql).run(...(values as never[]));
}

export function publicUser(row: UserRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    location: row.location,
    verified: Boolean(row.verified),
    organization: row.organization,
    createdAt: row.created_at,
  };
}

export function productRecord(row: ProductRow) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price: Number(row.price),
    quantity: Number(row.quantity),
    unit: row.unit,
    location: row.location,
    description: row.description,
    imageUrl: row.image_url,
    farmerId: Number(row.farmer_id),
    farmerName: row.farmer_name,
    verifiedFarmer: Boolean(row.verified_farmer),
    rating: Number(row.rating),
    reviewCount: Number(row.review_count),
    minBulkQuantity: Number(row.min_bulk_quantity),
    featured: Boolean(row.featured),
  };
}

export async function initializeFarmDirectDb(): Promise<void> {
  const userCount =
    (await one<{ count: number }>("SELECT COUNT(*)::int AS count FROM users"))?.count ?? 0;
  const timestamp = new Date().toISOString();
  const demoUsers = [
    {
      name: "FarmDirect Admin",
      email: "admin@farmdirect.com",
      password: "admin123",
      role: "admin" as const,
      location: "Mumbai, Maharashtra",
      verified: 1,
      organization: null,
    },
    {
      name: "Meera Patil",
      email: "farmer@farmdirect.com",
      password: "farmer123",
      role: "farmer" as const,
      location: "Nashik, Maharashtra",
      verified: 1,
      organization: "Meera Farms",
    },
    {
      name: "Arjun Shah",
      email: "buyer@farmdirect.com",
      password: "buyer123",
      role: "buyer" as const,
      location: "Pune, Maharashtra",
      verified: 0,
      organization: null,
    },
  ];

  if (userCount === 0) {
    for (const user of demoUsers) {
      const passwordHash = await bcrypt.hash(user.password, 10);
      await run(
        `INSERT INTO users (name, email, password_hash, role, location, verified, organization, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        user.name,
        user.email,
        passwordHash,
        user.role,
        user.location,
        user.verified,
        user.organization,
        timestamp,
      );
    }
  }

  const farmer = await one<UserRow>(
    "SELECT * FROM users WHERE email = ?",
    "farmer@farmdirect.com",
  );
  const buyer = await one<UserRow>(
    "SELECT * FROM users WHERE email = ?",
    "buyer@farmdirect.com",
  );
  if (!farmer || !buyer) return;

  await run(
    "INSERT INTO farmers (user_id, farm_name, description) VALUES (?, ?, ?) ON CONFLICT (user_id) DO NOTHING",
    farmer.id,
    "Meera Farms",
    "Family-grown seasonal produce from the Nashik valley.",
  );

  if (
    (await one<{ count: number }>("SELECT COUNT(*)::int AS count FROM products")?.count ?? 0) === 0
  ) {
    const products = [
      {
        name: "Vine-Ripened Tomatoes",
        category: "Vegetables",
        price: 38,
        quantity: 180,
        location: "Nashik, Maharashtra",
        description: "Firm, sun-ripened tomatoes picked fresh for today's harvest.",
        imageUrl: "https://images.unsplash.com/photo-1546094096-0df4bcaaa337?auto=format&fit=crop&w=900&q=85",
        minBulkQuantity: 25,
        featured: 1,
      },
      {
        name: "Red Onions",
        category: "Vegetables",
        price: 30,
        quantity: 320,
        location: "Nashik, Maharashtra",
        description: "A kitchen staple with a bold flavour and long shelf life.",
        imageUrl: "/red-onions.svg",
        minBulkQuantity: 50,
        featured: 1,
      },
      {
        name: "Kesar Mangoes",
        category: "Fruits",
        price: 110,
        quantity: 95,
        location: "Ratnagiri, Maharashtra",
        description: "Sweet, aromatic mangoes, carefully selected at peak ripeness.",
        imageUrl: "https://images.unsplash.com/photo-1553279768-865429fa0078?auto=format&fit=crop&w=900&q=85",
        minBulkQuantity: 20,
        featured: 1,
      },
      {
        name: "Kolam Rice",
        category: "Grains",
        price: 72,
        quantity: 500,
        location: "Kolhapur, Maharashtra",
        description: "Everyday soft-grain rice, cleaned and packed at the farm.",
        imageUrl: "https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=900&q=85",
        minBulkQuantity: 100,
        featured: 0,
      },
      {
        name: "Green Chillies",
        category: "Vegetables",
        price: 54,
        quantity: 75,
        location: "Nashik, Maharashtra",
        description: "Fresh, crisp chillies with a bright, balanced heat.",
        imageUrl: "https://images.unsplash.com/photo-1588252303782-cb80119abd6d?auto=format&fit=crop&w=900&q=85",
        minBulkQuantity: 15,
        featured: 0,
      },
      {
        name: "Fresh Spinach",
        category: "Organic Products",
        price: 42,
        quantity: 60,
        location: "Nashik, Maharashtra",
        description: "Tender leafy greens harvested in the cool morning hours.",
        imageUrl: "https://images.unsplash.com/photo-1576045057995-568f588f82fb?auto=format&fit=crop&w=900&q=85",
        minBulkQuantity: 10,
        featured: 0,
      },
    ];

    for (const product of products) {
      await run(
        `INSERT INTO products
          (name, category, price, quantity, unit, location, description, image_url, farmer_id, min_bulk_quantity, featured, created_at)
         VALUES (?, ?, ?, ?, 'kg', ?, ?, ?, ?, ?, ?, ?)`,
        product.name,
        product.category,
        product.price,
        product.quantity,
        product.location,
        product.description,
        product.imageUrl,
        farmer.id,
        product.minBulkQuantity,
        product.featured,
        timestamp,
      );
    }
  }

  await run(
    "UPDATE products SET image_url = ? WHERE name = ? AND image_url = ?",
    "/red-onions.svg",
    "Red Onions",
    "https://images.unsplash.com/photo-1518977676601-b53f82aba655?auto=format&fit=crop&w=900&q=85",
  );

  const pendingOrderExists =
    (await one<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM orders WHERE buyer_id = ?",
      buyer.id,
    ))?.count ?? 0;
  if (pendingOrderExists === 0) {
    const tomatoes = await one<{ id: number; name: string; price: number; image_url: string }>(
      "SELECT id, name, price, image_url FROM products WHERE name = ?",
      "Vine-Ripened Tomatoes",
    );
    const rice = await one<{ id: number; name: string; price: number; image_url: string }>(
      "SELECT id, name, price, image_url FROM products WHERE name = ?",
      "Kolam Rice",
    );
    if (tomatoes && rice) {
      const pending = await run(
        `INSERT INTO orders (buyer_id, status, delivery_address, payment_method, total, created_at)
         VALUES (?, 'Pending', ?, 'cod', ?, ?)`,
        buyer.id,
        "12 Koregaon Park, Pune, Maharashtra 411001",
        tomatoes.price * 4,
        timestamp,
      );
      const delivered = await run(
        `INSERT INTO orders (buyer_id, status, delivery_address, payment_method, total, created_at)
         VALUES (?, 'Delivered', ?, 'cod', ?, ?)`,
        buyer.id,
        "12 Koregaon Park, Pune, Maharashtra 411001",
        rice.price * 10,
        timestamp,
      );
      await run(
        `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, image_url, farmer_id, farmer_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        Number(pending.lastInsertRowid),
        tomatoes.id,
        tomatoes.name,
        4,
        tomatoes.price,
        tomatoes.image_url,
        farmer.id,
        farmer.name,
      );
      await run(
        `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, image_url, farmer_id, farmer_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        Number(delivered.lastInsertRowid),
        rice.id,
        rice.name,
        10,
        rice.price,
        rice.image_url,
        farmer.id,
        farmer.name,
      );
      await run(
        `INSERT INTO reviews (product_id, order_id, buyer_id, rating, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        rice.id,
        Number(delivered.lastInsertRowid),
        buyer.id,
        5,
        "Lovely quality and carefully packed. We will order again.",
        timestamp,
      );
    }
  }
}
