const { Pool } = require("pg");
const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "caching_research",
  password: "",
  port: 5432,
});

const USERS = 10000;
const PRODUCTS = 5000;
const ORDERS = 20000;
const ORDER_ITEMS = 50000;
const REVIEWS = 30000;
const TAGS = 50;
const CATEGORIES = 10;
const BATCH_SIZE = 500;

async function seed() {
  console.log("Starting seed...");
  try {
    // Categories
    const categories = [
      "Electronics",
      "Clothing",
      "Books",
      "Home",
      "Sports",
      "Toys",
      "Food",
      "Beauty",
      "Automotive",
      "Garden",
    ];
    await pool.query(
      "INSERT INTO categories (name) VALUES " +
        categories.map((_, i) => `($${i + 1})`).join(", "),
      categories
    );

    // Users batch insert
    console.log("Seeding users...");
    for (let i = 0; i < USERS; i += BATCH_SIZE) {
      const batch = [];
      const params = [];
      for (let j = 0; j < BATCH_SIZE && i + j < USERS; j++) {
        batch.push(`($${params.length + 1}, $${params.length + 2})`);
        params.push(`User ${i + j + 1}`, `user${i + j + 1}@example.com`);
      }
      await pool.query(
        `INSERT INTO users (name,email) VALUES ${batch.join(", ")}`,
        params
      );
      console.log(`  Inserted ${Math.min(i + BATCH_SIZE, USERS)} users`);
    }

    // Tags
    const tagParams = Array.from({ length: TAGS }, (_, i) => `Tag${i + 1}`);
    await pool.query(
      "INSERT INTO tags (name) VALUES " +
        tagParams.map((_, i) => `($${i + 1})`).join(", "),
      tagParams
    );

    // Products batch insert
    console.log("Seeding products...");
    for (let i = 0; i < PRODUCTS; i += BATCH_SIZE) {
      const batch = [];
      const params = [];
      for (let j = 0; j < BATCH_SIZE && i + j < PRODUCTS; j++) {
        const categoryId = Math.floor(Math.random() * CATEGORIES) + 1;
        const price = (Math.random() * 500 + 10).toFixed(2);
        batch.push(
          `($${params.length + 1}, $${params.length + 2}, $${
            params.length + 3
          }, $${params.length + 4})`
        );
        params.push(
          `Product ${i + j + 1}`,
          `Description ${i + j + 1}`,
          price,
          categoryId
        );
      }
      await pool.query(
        `INSERT INTO products (name,description,price,category_id) VALUES ${batch.join(
          ", "
        )}`,
        params
      );
      console.log(`  Inserted ${Math.min(i + BATCH_SIZE, PRODUCTS)} products`);
    }

    // Inventory
    console.log("Seeding inventory...");
    for (let i = 1; i <= PRODUCTS; i += BATCH_SIZE) {
      const batch = [];
      const params = [];
      for (let j = 0; j < BATCH_SIZE && i + j <= PRODUCTS; j++) {
        batch.push(`($${params.length + 1}, $${params.length + 2})`);
        params.push(i + j, Math.floor(Math.random() * 1000));
      }
      await pool.query(
        `INSERT INTO inventory (product_id, stock) VALUES ${batch.join(", ")}`,
        params
      );
    }

    // Orders
    console.log("Seeding orders...");
    for (let i = 0; i < ORDERS; i += BATCH_SIZE) {
      const batch = [];
      const params = [];
      for (let j = 0; j < BATCH_SIZE && i + j < ORDERS; j++) {
        const userId = Math.floor(Math.random() * 10000) + 1;
        const total = (Math.random() * 1000 + 50).toFixed(2);
        batch.push(`($${params.length + 1}, $${params.length + 2})`);
        params.push(userId, total);
      }
      await pool.query(
        `INSERT INTO orders (user_id, total_amount) VALUES ${batch.join(", ")}`,
        params
      );
      console.log(`  Inserted ${Math.min(i + BATCH_SIZE, ORDERS)} orders`);
    }

    // Order Items
    console.log("Seeding order_items...");
    for (let i = 0; i < ORDER_ITEMS; i += BATCH_SIZE) {
      const batch = [];
      const params = [];
      for (let j = 0; j < BATCH_SIZE && i + j < ORDER_ITEMS; j++) {
        const orderId = Math.floor(Math.random() * ORDERS) + 1;
        const productId = Math.floor(Math.random() * 5000) + 1;
        const quantity = Math.floor(Math.random() * 5) + 1;
        const unitPrice = (Math.random() * 200 + 10).toFixed(2);
        batch.push(
          `($${params.length + 1}, $${params.length + 2}, $${
            params.length + 3
          }, $${params.length + 4})`
        );
        params.push(orderId, productId, quantity, unitPrice);
      }
      await pool.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ${batch.join(
          ", "
        )}`,
        params
      );
      console.log(
        `  Inserted ${Math.min(i + BATCH_SIZE, ORDER_ITEMS)} order items`
      );
    }

    // Reviews
    console.log("Seeding reviews...");
    for (let i = 0; i < REVIEWS; i += BATCH_SIZE) {
      const batch = [];
      const params = [];
      for (let j = 0; j < BATCH_SIZE && i + j < REVIEWS; j++) {
        const userId = Math.floor(Math.random() * 10000) + 1;
        const productId = Math.floor(Math.random() * 5000) + 1;
        const rating = Math.floor(Math.random() * 5) + 1;
        batch.push(
          `($${params.length + 1}, $${params.length + 2}, $${
            params.length + 3
          }, $${params.length + 4})`
        );
        params.push(userId, productId, rating, `Review comment ${i + j + 1}`);
      }
      await pool.query(
        `INSERT INTO reviews (user_id, product_id, rating, comment) VALUES ${batch.join(
          ", "
        )}`,
        params
      );
      console.log(`  Inserted ${Math.min(i + BATCH_SIZE, REVIEWS)} reviews`);
    }

    console.log("Seed completed!");
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

seed();
