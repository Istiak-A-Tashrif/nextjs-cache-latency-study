\set ON_ERROR_STOP on
CREATE TEMP TABLE corrected AS
SELECT p.id, p.name, c.name AS category,
 COALESCE(o.total_orders,0) AS total_orders,
 COALESCE(r.avg_rating,0) AS avg_rating, COALESCE(i.stock,0) AS stock
FROM products p
LEFT JOIN categories c ON c.id=p.category_id
LEFT JOIN (SELECT product_id, COUNT(DISTINCT order_id) AS total_orders
 FROM order_items GROUP BY product_id) o ON o.product_id=p.id
LEFT JOIN (SELECT product_id, AVG(rating) AS avg_rating
 FROM reviews GROUP BY product_id) r ON r.product_id=p.id
LEFT JOIN inventory i ON i.product_id=p.id
ORDER BY p.id LIMIT ALL OFFSET 0;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM corrected q WHERE
 q.total_orders IS DISTINCT FROM (SELECT COUNT(DISTINCT order_id) FROM order_items WHERE product_id=q.id)
 OR q.avg_rating IS DISTINCT FROM COALESCE((SELECT AVG(rating) FROM reviews WHERE product_id=q.id),0)
 OR q.stock IS DISTINCT FROM COALESCE((SELECT stock FROM inventory WHERE product_id=q.id),0))
 THEN RAISE EXCEPTION 'corrected query differs from independent scalar oracle'; END IF;
END $$;
SELECT json_build_object('check','all_product_aggregates','rows',(SELECT COUNT(*) FROM corrected),'mismatches',0);
SELECT json_object_agg(name,n) FROM (
SELECT 'users' name,COUNT(*) n FROM users UNION ALL SELECT 'products',COUNT(*) FROM products
UNION ALL SELECT 'categories',COUNT(*) FROM categories UNION ALL SELECT 'orders',COUNT(*) FROM orders
UNION ALL SELECT 'order_items',COUNT(*) FROM order_items UNION ALL SELECT 'reviews',COUNT(*) FROM reviews
UNION ALL SELECT 'inventory',COUNT(*) FROM inventory UNION ALL SELECT 'tags',COUNT(*) FROM tags
UNION ALL SELECT 'product_tags',COUNT(*) FROM product_tags) s;
SELECT json_build_object('legacy_count_mismatches',COUNT(*)) FROM corrected q JOIN
(SELECT p.id,COUNT(oi.id) n FROM products p LEFT JOIN order_items oi ON oi.product_id=p.id
LEFT JOIN reviews r ON r.product_id=p.id GROUP BY p.id) old ON q.id=old.id WHERE q.total_orders<>old.n;
