import { createHmac, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  ApproveFarmerBody,
  ApproveFarmerParams,
  ApproveFarmerResponse,
  CheckoutBody,
  CheckoutResponse,
  CreateBulkRequestResponse,
  CreateProductResponse,
  CreateReviewResponse,
  CreateBulkRequestBody,
  CreateProductBody,
  CreateReviewBody,
  DeleteProductParams,
  GetAdminOrdersResponse,
  GetAdminProductsResponse,
  GetAdminUsersResponse,
  GetBulkRequestsResponse,
  GetMarketplaceStatsResponse,
  GetMeResponse,
  GetMyOrdersResponse,
  GetProductParams,
  GetProductReviewsParams,
  GetProductReviewsResponse,
  GetProductResponse,
  GetProductsQueryParams,
  GetProductsResponse,
  LoginBody,
  LoginResponse,
  RegisterBody,
  RegisterResponse,
  UpdateOrderStatusBody,
  UpdateOrderStatusParams,
  UpdateOrderStatusResponse,
  UpdateProductBody,
  UpdateProductParams,
  UpdateProductResponse,
} from "@workspace/api-zod";
import {
  many,
  one,
  productRecord,
  publicUser,
  run,
  type OrderRow,
  type ProductRow,
  type UserRole,
  type UserRow,
  database,
} from "../lib/farmdirect-db";

const router: IRouter = Router();
const secret = process.env.SESSION_SECRET;
if (!secret) {
  throw new Error("SESSION_SECRET must be configured to sign FarmDirect sessions.");
}

type TokenPayload = { sub: number; exp: number };
type ProductInput = {
  name: string;
  category: string;
  price: number;
  quantity: number;
  unit?: string;
  location: string;
  description: string;
  imageUrl?: string;
  minBulkQuantity?: number;
  featured?: boolean;
};

function signToken(user: UserRow): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 }),
  ).toString("base64url");
  const unsigned = `${header}.${payload}`;
  const signature = createHmac("sha256", secret as string).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

function verifyToken(token: string): TokenPayload | null {
  const [header, payload, signature, extra] = token.split(".");
  if (!header || !payload || !signature || extra) return null;
  const unsigned = `${header}.${payload}`;
  const expected = createHmac("sha256", secret as string).update(unsigned).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(expected, provided)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TokenPayload;
    if (!Number.isInteger(decoded.sub) || decoded.exp <= Math.floor(Date.now() / 1000)) return null;
    return decoded;
  } catch {
    return null;
  }
}

const requireAuth: RequestHandler = (req, res, next) => {
  const authorization = req.header("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  const payload = token ? verifyToken(token) : null;
  const user = payload ? one<UserRow>("SELECT * FROM users WHERE id = ?", payload.sub) : undefined;
  if (!user) {
    res.status(401).json({ error: "Please sign in to continue." });
    return;
  }
  res.locals.user = user;
  next();
};

function requireRole(...roles: UserRole[]): RequestHandler {
  return (_req, res, next) => {
    const user = res.locals.user as UserRow | undefined;
    if (!user || !roles.includes(user.role)) {
      res.status(403).json({ error: "You do not have permission to do that." });
      return;
    }
    next();
  };
}

function productSql(where = ""): string {
  return `SELECT p.*, u.name AS farmer_name, u.verified AS verified_farmer,
            COALESCE(AVG(r.rating), 0) AS rating, COUNT(r.id) AS review_count
          FROM products p
          JOIN users u ON u.id = p.farmer_id
          LEFT JOIN reviews r ON r.product_id = p.id
          ${where}
          GROUP BY p.id
          ORDER BY p.featured DESC, p.created_at DESC`;
}

function productById(id: number): ProductRow | undefined {
  return one<ProductRow>(productSql("WHERE p.id = ?"), id);
}

type OrderItemRow = {
  id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  unit_price: number;
  image_url: string;
  farmer_id: number;
  farmer_name: string;
};

function orderById(id: number): Record<string, unknown> | undefined {
  const order = one<OrderRow>(
    `SELECT o.*, u.name AS buyer_name
     FROM orders o JOIN users u ON u.id = o.buyer_id WHERE o.id = ?`,
    id,
  );
  if (!order) return undefined;
  const items = many<OrderItemRow>("SELECT * FROM order_items WHERE order_id = ?", id).map(
    (item) => ({
      id: item.id,
      productId: item.product_id,
      productName: item.product_name,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      imageUrl: item.image_url,
      farmerId: item.farmer_id,
      farmerName: item.farmer_name,
    }),
  );
  return {
    id: order.id,
    buyerId: order.buyer_id,
    buyerName: order.buyer_name,
    status: order.status,
    deliveryAddress: order.delivery_address,
    paymentMethod: order.payment_method,
    total: order.total,
    createdAt: order.created_at,
    items,
  };
}

function ordersForUser(user: UserRow): Record<string, unknown>[] {
  let orders: OrderRow[];
  if (user.role === "farmer") {
    orders = many<OrderRow>(
      `SELECT DISTINCT o.*, u.name AS buyer_name
       FROM orders o JOIN users u ON u.id = o.buyer_id
       JOIN order_items i ON i.order_id = o.id
       WHERE i.farmer_id = ? ORDER BY o.created_at DESC`,
      user.id,
    );
  } else {
    orders = many<OrderRow>(
      `SELECT o.*, u.name AS buyer_name
       FROM orders o JOIN users u ON u.id = o.buyer_id
       WHERE o.buyer_id = ? ORDER BY o.created_at DESC`,
      user.id,
    );
  }
  return orders.map((order) => orderById(order.id)).filter(Boolean) as Record<string, unknown>[];
}

function bulkRows(user: UserRow) {
  const filter =
    user.role === "farmer"
      ? "WHERE p.farmer_id = ?"
      : "WHERE b.buyer_id = ?";
  const rows = many<Record<string, unknown>>(
    `SELECT b.*, u.name AS buyer_name, p.name AS product_name
     FROM bulk_requests b
     JOIN users u ON u.id = b.buyer_id
     JOIN products p ON p.id = b.product_id
     ${filter}
     ORDER BY b.created_at DESC`,
    user.id,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    buyerId: Number(row.buyer_id),
    buyerName: String(row.buyer_name),
    productId: Number(row.product_id),
    productName: String(row.product_name),
    quantity: Number(row.quantity),
    targetPrice: row.target_price === null ? null : Number(row.target_price),
    notes: String(row.notes),
    status: String(row.status),
    createdAt: String(row.created_at),
  }));
}

function productInputValues(input: ProductInput) {
  return [
    input.name.trim(),
    input.category,
    input.price,
    input.quantity,
    input.unit?.trim() || "kg",
    input.location.trim(),
    input.description.trim(),
    input.imageUrl?.trim() || "",
  ];
}

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email and password." });
    return;
  }
  const user = one<UserRow>(
    "SELECT * FROM users WHERE email = ?",
    parsed.data.email.trim().toLowerCase(),
  );
  if (!user || !(await bcrypt.compare(parsed.data.password, user.password_hash))) {
    res.status(401).json({ error: "Email or password is incorrect." });
    return;
  }
  res.json(LoginResponse.parse({ token: signToken(user), user: publicUser(user) }));
});

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const email = input.email.trim().toLowerCase();
  if (one("SELECT id FROM users WHERE email = ?", email)) {
    res.status(409).json({ error: "An account with this email already exists." });
    return;
  }
  const passwordHash = await bcrypt.hash(input.password, 10);
  const createdAt = new Date().toISOString();
  const result = run(
    `INSERT INTO users (name, email, password_hash, role, location, verified, organization, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    input.name.trim(),
    email,
    passwordHash,
    input.role,
    input.location.trim(),
    input.organization?.trim() || null,
    createdAt,
  );
  const user = one<UserRow>("SELECT * FROM users WHERE id = ?", Number(result.lastInsertRowid));
  if (!user) {
    res.status(500).json({ error: "Account could not be created." });
    return;
  }
  if (user.role === "farmer") {
    run(
      "INSERT INTO farmers (user_id, farm_name, description) VALUES (?, ?, '')",
      user.id,
      input.organization?.trim() || `${input.name.trim()}'s Farm`,
    );
  }
  res.status(201).json(RegisterResponse.parse({ token: signToken(user), user: publicUser(user) }));
});

router.get("/auth/me", requireAuth, (req, res): void => {
  res.json(GetMeResponse.parse(publicUser(res.locals.user as UserRow)));
});

router.get("/products", (req, res): void => {
  const parsed = GetProductsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const predicates: string[] = [];
  const params: unknown[] = [];
  const search = parsed.data.search?.trim();
  if (search) {
    predicates.push("(LOWER(p.name) LIKE ? OR LOWER(p.description) LIKE ? OR LOWER(u.name) LIKE ?)");
    const pattern = `%${search.toLowerCase()}%`;
    params.push(pattern, pattern, pattern);
  }
  if (parsed.data.category) {
    predicates.push("p.category = ?");
    params.push(parsed.data.category);
  }
  if (parsed.data.location?.trim()) {
    predicates.push("LOWER(p.location) LIKE ?");
    params.push(`%${parsed.data.location.trim().toLowerCase()}%`);
  }
  if (req.query.featured === "true") {
    predicates.push("p.featured = 1");
  }
  const where = predicates.length ? `WHERE ${predicates.join(" AND ")}` : "";
  const products = many<ProductRow>(productSql(where), ...params).map(productRecord);
  res.json(GetProductsResponse.parse(products));
});

router.post("/products", requireAuth, requireRole("farmer"), (req, res): void => {
  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = res.locals.user as UserRow;
  const input = parsed.data as ProductInput;
  const result = run(
    `INSERT INTO products
      (name, category, price, quantity, unit, location, description, image_url, farmer_id, min_bulk_quantity, featured, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ...productInputValues(input),
    user.id,
    input.minBulkQuantity ?? 25,
    input.featured ? 1 : 0,
    new Date().toISOString(),
  );
  const product = productById(Number(result.lastInsertRowid));
  if (!product) {
    res.status(500).json({ error: "Product could not be saved." });
    return;
  }
  res.status(201).json(CreateProductResponse.parse(productRecord(product)));
});

router.get("/products/:id", (req, res): void => {
  const parsed = GetProductParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid product id." });
    return;
  }
  const product = productById(parsed.data.id);
  if (!product) {
    res.status(404).json({ error: "Product not found." });
    return;
  }
  res.json(GetProductResponse.parse(productRecord(product)));
});

router.patch("/products/:id", requireAuth, requireRole("farmer", "admin"), (req, res): void => {
  const params = UpdateProductParams.safeParse({ id: req.params.id });
  const body = UpdateProductBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Check the product details and try again." });
    return;
  }
  const current = one<ProductRow>("SELECT * FROM products WHERE id = ?", params.data.id);
  if (!current) {
    res.status(404).json({ error: "Product not found." });
    return;
  }
  const user = res.locals.user as UserRow;
  if (user.role !== "admin" && current.farmer_id !== user.id) {
    res.status(403).json({ error: "You can only edit your own products." });
    return;
  }
  const input = body.data as Partial<ProductInput>;
  const fields: Record<string, string> = {
    name: "name",
    category: "category",
    price: "price",
    quantity: "quantity",
    unit: "unit",
    location: "location",
    description: "description",
    imageUrl: "image_url",
    minBulkQuantity: "min_bulk_quantity",
    featured: "featured",
  };
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(fields)) {
    if (!(key in input)) continue;
    const value = input[key as keyof ProductInput];
    sets.push(`${column} = ?`);
    values.push(key === "featured" ? (value ? 1 : 0) : value);
  }
  if (sets.length) {
    values.push(params.data.id);
    run(`UPDATE products SET ${sets.join(", ")} WHERE id = ?`, ...values);
  }
  const updated = productById(params.data.id);
  res.json(UpdateProductResponse.parse(productRecord(updated as ProductRow)));
});

router.delete(
  "/products/:id",
  requireAuth,
  requireRole("farmer", "admin"),
  (req, res): void => {
    const parsed = DeleteProductParams.safeParse({ id: req.params.id });
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid product id." });
      return;
    }
    const product = one<{ id: number; farmer_id: number }>(
      "SELECT id, farmer_id FROM products WHERE id = ?",
      parsed.data.id,
    );
    if (!product) {
      res.status(404).json({ error: "Product not found." });
      return;
    }
    const user = res.locals.user as UserRow;
    if (user.role !== "admin" && product.farmer_id !== user.id) {
      res.status(403).json({ error: "You can only remove your own products." });
      return;
    }
    run("DELETE FROM products WHERE id = ?", parsed.data.id);
    res.sendStatus(204);
  },
);

router.get("/orders", requireAuth, (req, res): void => {
  const user = res.locals.user as UserRow;
  if (!["farmer", "buyer", "business"].includes(user.role)) {
    res.status(403).json({ error: "This account does not have marketplace orders." });
    return;
  }
  res.json(GetMyOrdersResponse.parse(ordersForUser(user)));
});

router.post("/orders", requireAuth, requireRole("buyer", "business"), (req, res): void => {
  const parsed = CheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = res.locals.user as UserRow;
  const quantities = new Map<number, number>();
  for (const item of parsed.data.items) {
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  }
  database.exec("BEGIN IMMEDIATE");
  try {
    const products = [...quantities.entries()].map(([productId, quantity]) => {
      const product = one<ProductRow>(
        `SELECT p.*, u.name AS farmer_name, u.verified AS verified_farmer,
          0 AS rating, 0 AS review_count
         FROM products p JOIN users u ON u.id = p.farmer_id WHERE p.id = ?`,
        productId,
      );
      if (!product || product.quantity < quantity) {
        throw new Error(`Not enough stock available for ${product?.name ?? "one of these products"}.`);
      }
      return { product, quantity };
    });
    const total = products.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
    const createdAt = new Date().toISOString();
    const result = run(
      `INSERT INTO orders (buyer_id, status, delivery_address, payment_method, total, created_at)
       VALUES (?, 'Pending', ?, 'cod', ?, ?)`,
      user.id,
      parsed.data.deliveryAddress.trim(),
      total,
      createdAt,
    );
    const orderId = Number(result.lastInsertRowid);
    for (const { product, quantity } of products) {
      run("UPDATE products SET quantity = quantity - ? WHERE id = ?", quantity, product.id);
      run(
        `INSERT INTO order_items
          (order_id, product_id, product_name, quantity, unit_price, image_url, farmer_id, farmer_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        orderId,
        product.id,
        product.name,
        quantity,
        product.price,
        product.image_url,
        product.farmer_id,
        product.farmer_name,
      );
    }
    database.exec("COMMIT");
    res.status(201).json(CheckoutResponse.parse(orderById(orderId)));
  } catch (error) {
    database.exec("ROLLBACK");
    res.status(400).json({
      error: error instanceof Error ? error.message : "Your order could not be placed.",
    });
  }
});

router.patch(
  "/orders/:id/status",
  requireAuth,
  requireRole("farmer", "buyer", "admin"),
  (req, res): void => {
    const params = UpdateOrderStatusParams.safeParse({ id: req.params.id });
    const body = UpdateOrderStatusBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Choose a valid order status." });
      return;
    }
    const user = res.locals.user as UserRow;
    const order = one<{ id: number; buyer_id: number; status: string }>(
      "SELECT id, buyer_id, status FROM orders WHERE id = ?",
      params.data.id,
    );
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    const ownsItems =
      user.role === "admin" ||
      (user.role === "farmer" &&
        Boolean(
          one(
            "SELECT id FROM order_items WHERE order_id = ? AND farmer_id = ? LIMIT 1",
            order.id,
            user.id,
          ),
        ));
    const buyerCanCancel =
      user.role === "buyer" &&
      order.buyer_id === user.id &&
      order.status === "Pending" &&
      body.data.status === "Cancelled";
    if (!ownsItems && !buyerCanCancel) {
      res.status(403).json({ error: "You cannot update this order." });
      return;
    }
    const progression: Record<string, string[]> = {
      Pending: ["Confirmed", "Cancelled"],
      Confirmed: ["Processing"],
      Processing: ["Shipped"],
      Shipped: ["Delivered"],
    };
    if (
      user.role !== "admin" &&
      !(progression[order.status] ?? []).includes(body.data.status)
    ) {
      res.status(400).json({ error: "Order status can only move to the next step." });
      return;
    }
    run("UPDATE orders SET status = ? WHERE id = ?", body.data.status, order.id);
    res.json(UpdateOrderStatusResponse.parse(orderById(order.id)));
  },
);

router.post("/reviews", requireAuth, requireRole("buyer"), (req, res): void => {
  const parsed = CreateReviewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = res.locals.user as UserRow;
  const input = parsed.data;
  const eligible = one(
    `SELECT oi.id FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.id = ? AND o.buyer_id = ? AND o.status = 'Delivered' AND oi.product_id = ?`,
    input.orderId,
    user.id,
    input.productId,
  );
  if (!eligible) {
    res.status(400).json({ error: "Reviews are available after a delivered purchase." });
    return;
  }
  if (one("SELECT id FROM reviews WHERE order_id = ? AND product_id = ?", input.orderId, input.productId)) {
    res.status(409).json({ error: "You have already reviewed this product." });
    return;
  }
  const result = run(
    `INSERT INTO reviews (product_id, order_id, buyer_id, rating, comment, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    input.productId,
    input.orderId,
    user.id,
    input.rating,
    input.comment.trim(),
    new Date().toISOString(),
  );
  const review = one<Record<string, unknown>>(
    `SELECT r.*, u.name AS buyer_name
     FROM reviews r JOIN users u ON u.id = r.buyer_id WHERE r.id = ?`,
    Number(result.lastInsertRowid),
  );
  res.status(201).json(
    CreateReviewResponse.parse({
      id: Number(review?.id),
      productId: Number(review?.product_id),
      buyerId: Number(review?.buyer_id),
      buyerName: String(review?.buyer_name),
      rating: Number(review?.rating),
      comment: String(review?.comment),
      createdAt: String(review?.created_at),
    }),
  );
});

router.get("/products/:id/reviews", (req, res): void => {
  const parsed = GetProductReviewsParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid product id." });
    return;
  }
  const reviews = many<Record<string, unknown>>(
    `SELECT r.*, u.name AS buyer_name FROM reviews r
     JOIN users u ON u.id = r.buyer_id
     WHERE r.product_id = ? ORDER BY r.created_at DESC`,
    parsed.data.id,
  ).map((row) => ({
    id: Number(row.id),
    productId: Number(row.product_id),
    buyerId: Number(row.buyer_id),
    buyerName: String(row.buyer_name),
    rating: Number(row.rating),
    comment: String(row.comment),
    createdAt: String(row.created_at),
  }));
  res.json(GetProductReviewsResponse.parse(reviews));
});

router.get("/bulk-requests", requireAuth, requireRole("farmer", "business", "buyer"), (req, res): void => {
  res.json(GetBulkRequestsResponse.parse(bulkRows(res.locals.user as UserRow)));
});

router.post(
  "/bulk-requests",
  requireAuth,
  requireRole("business", "buyer"),
  (req, res): void => {
    const parsed = CreateBulkRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const product = one<{ id: number }>(
      "SELECT id FROM products WHERE id = ?",
      parsed.data.productId,
    );
    if (!product) {
      res.status(404).json({ error: "Product not found." });
      return;
    }
    const user = res.locals.user as UserRow;
    const result = run(
      `INSERT INTO bulk_requests (buyer_id, product_id, quantity, target_price, notes, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'Pending', ?)`,
      user.id,
      parsed.data.productId,
      parsed.data.quantity,
      parsed.data.targetPrice ?? null,
      parsed.data.notes.trim(),
      new Date().toISOString(),
    );
    const row = many<Record<string, unknown>>(
      `SELECT b.*, u.name AS buyer_name, p.name AS product_name
       FROM bulk_requests b JOIN users u ON u.id = b.buyer_id
       JOIN products p ON p.id = b.product_id WHERE b.id = ?`,
      Number(result.lastInsertRowid),
    )[0];
    res.status(201).json(
      CreateBulkRequestResponse.parse({
        id: Number(row.id),
        buyerId: Number(row.buyer_id),
        buyerName: String(row.buyer_name),
        productId: Number(row.product_id),
        productName: String(row.product_name),
        quantity: Number(row.quantity),
        targetPrice: row.target_price === null ? null : Number(row.target_price),
        notes: String(row.notes),
        status: String(row.status),
        createdAt: String(row.created_at),
      }),
    );
  },
);

router.get("/marketplace/stats", (_req, res): void => {
  const stats = {
    productCount: Number(one<{ count: number }>("SELECT COUNT(*) AS count FROM products")?.count ?? 0),
    farmerCount: Number(
      one<{ count: number }>("SELECT COUNT(*) AS count FROM users WHERE role = 'farmer' AND verified = 1")
        ?.count ?? 0,
    ),
    orderCount: Number(one<{ count: number }>("SELECT COUNT(*) AS count FROM orders")?.count ?? 0),
    revenue: Number(
      one<{ total: number }>("SELECT COALESCE(SUM(total), 0) AS total FROM orders WHERE status = 'Delivered'")
        ?.total ?? 0,
    ),
  };
  res.json(GetMarketplaceStatsResponse.parse(stats));
});

router.get("/admin/users", requireAuth, requireRole("admin"), (_req, res): void => {
  const users = many<UserRow>("SELECT * FROM users ORDER BY created_at DESC").map(publicUser);
  res.json(GetAdminUsersResponse.parse(users));
});

router.patch(
  "/admin/users/:id/approval",
  requireAuth,
  requireRole("admin"),
  (req, res): void => {
    const params = ApproveFarmerParams.safeParse({ id: req.params.id });
    const body = ApproveFarmerBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Choose a valid farmer approval status." });
      return;
    }
    const user = one<UserRow>(
      "SELECT * FROM users WHERE id = ? AND role = 'farmer'",
      params.data.id,
    );
    if (!user) {
      res.status(404).json({ error: "Farmer not found." });
      return;
    }
    run("UPDATE users SET verified = ? WHERE id = ?", body.data.verified ? 1 : 0, user.id);
    const updated = one<UserRow>("SELECT * FROM users WHERE id = ?", user.id);
    res.json(ApproveFarmerResponse.parse(publicUser(updated as UserRow)));
  },
);

router.get("/admin/products", requireAuth, requireRole("admin"), (_req, res): void => {
  const products = many<ProductRow>(productSql()).map(productRecord);
  res.json(GetAdminProductsResponse.parse(products));
});

router.get("/admin/orders", requireAuth, requireRole("admin"), (_req, res): void => {
  const orders = many<OrderRow>(
    `SELECT o.*, u.name AS buyer_name FROM orders o
     JOIN users u ON u.id = o.buyer_id ORDER BY o.created_at DESC`,
  ).map((order) => orderById(order.id));
  res.json(GetAdminOrdersResponse.parse(orders.filter(Boolean)));
});

export default router;
