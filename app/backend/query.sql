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
ORDER BY p.id LIMIT $1 OFFSET $2
