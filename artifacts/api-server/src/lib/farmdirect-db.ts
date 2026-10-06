import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";

const dataDirectory = join(process.cwd(), "data");
mkdirSync(dataDirectory, { recursive: true });

export const database = new DatabaseSync(
  process.env.FARMDIRECT_DB_PATH ?? join(dataDirectory, "farmdirect.sqlite"),
);

database.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('farmer', 'buyer', 'business', 'admin')),
    location TEXT NOT NULL DEFAULT '',
    verified INTEGER NOT NULL DEFAULT 0,
    organization TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS farmers (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    farm_name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL NOT NULL CHECK (price > 0),
    quantity REAL NOT NULL CHECK (quantity >= 0),
    unit TEXT NOT NULL DEFAULT 'kg',
    location TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    farmer_id INTEGER NOT NULL REFERENCES users(id),
    min_bulk_quantity REAL NOT NULL DEFAULT 25,
    featured INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    buyer_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'Pending',
    delivery_address TEXT NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'cod',
    total REAL NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit_price REAL NOT NULL,
    image_url TEXT NOT NULL DEFAULT '',
    farmer_id INTEGER NOT NULL,
    farmer_name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    buyer_id INTEGER NOT NULL REFERENCES users(id),
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (order_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS bulk_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    buyer_id INTEGER NOT NULL REFERENCES users(id),
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity REAL NOT NULL,
    target_price REAL,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Pending',
    created_at TEXT NOT NULL
  );
`);

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
    price: row.price,
    quantity: row.quantity,
    unit: row.unit,
    location: row.location,
    description: row.description,
    imageUrl: row.image_url,
    farmerId: row.farmer_id,
    farmerName: row.farmer_name,
    verifiedFarmer: Boolean(row.verified_farmer),
    rating: row.rating,
    reviewCount: row.review_count,
    minBulkQuantity: row.min_bulk_quantity,
    featured: Boolean(row.featured),
  };
}

export async function initializeFarmDirectDb(): Promise<void> {
  const userCount = one<{ count: number }>("SELECT COUNT(*) AS count FROM users")
    ?.count ?? 0;
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
      run(
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

  const farmer = one<UserRow>("SELECT * FROM users WHERE email = ?", "farmer@farmdirect.com");
  const buyer = one<UserRow>("SELECT * FROM users WHERE email = ?", "buyer@farmdirect.com");
  if (!farmer || !buyer) return;

  run(
    "INSERT OR IGNORE INTO farmers (user_id, farm_name, description) VALUES (?, ?, ?)",
    farmer.id,
    "Meera Farms",
    "Family-grown seasonal produce from the Nashik valley.",
  );

  if ((one<{ count: number }>("SELECT COUNT(*) AS count FROM products")?.count ?? 0) === 0) {
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
      run(
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

  run(
    "UPDATE products SET image_url = ? WHERE name = ? AND image_url = ?",
    "/red-onions.svg",
    "Red Onions",
    "https://images.unsplash.com/photo-1518977676601-b53f82aba655?auto=format&fit=crop&w=900&q=85",
  );

  const pendingOrderExists = one<{ count: number }>(
    "SELECT COUNT(*) AS count FROM orders WHERE buyer_id = ?",
    buyer.id,
  )?.count ?? 0;
  if (pendingOrderExists === 0) {
    const tomatoes = one<{ id: number; name: string; price: number; image_url: string }>(
      "SELECT id, name, price, image_url FROM products WHERE name = ?",
      "Vine-Ripened Tomatoes",
    );
    const rice = one<{ id: number; name: string; price: number; image_url: string }>(
      "SELECT id, name, price, image_url FROM products WHERE name = ?",
      "Kolam Rice",
    );
    if (tomatoes && rice) {
      const pending = run(
        `INSERT INTO orders (buyer_id, status, delivery_address, payment_method, total, created_at)
         VALUES (?, 'Pending', ?, 'cod', ?, ?)`,
        buyer.id,
        "12 Koregaon Park, Pune, Maharashtra 411001",
        tomatoes.price * 4,
        timestamp,
      );
      const delivered = run(
        `INSERT INTO orders (buyer_id, status, delivery_address, payment_method, total, created_at)
         VALUES (?, 'Delivered', ?, 'cod', ?, ?)`,
        buyer.id,
        "12 Koregaon Park, Pune, Maharashtra 411001",
        rice.price * 10,
        timestamp,
      );
      run(
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
      run(
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
      run(
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
