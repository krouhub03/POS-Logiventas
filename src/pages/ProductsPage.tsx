import { useEffect, useState } from "react";
import { api } from "../services/api";
import { formatCents } from "../lib/money";
import type { Product } from "../types";

export function ProductsPage() {
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api.products
        .list(search)
        .then((list) => {
          setProducts(list);
          setError(null);
        })
        .catch((e) => setError(String(e)));
    }, 200);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <section className="page">
      <header className="page-header">
        <h2>Productos</h2>
        <input
          autoFocus
          className="search"
          placeholder="Buscar por nombre, SKU o código de barras…"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
      </header>

      {error && <p className="error">{error}</p>}

      <table className="table">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Nombre</th>
            <th className="num">Precio</th>
            <th className="num">Existencia</th>
          </tr>
        </thead>
        <tbody>
          {products.length === 0 ? (
            <tr>
              <td colSpan={4} className="empty">
                Sin productos registrados
              </td>
            </tr>
          ) : (
            products.map((p) => (
              <tr key={p.id}>
                <td>{p.sku}</td>
                <td>{p.name}</td>
                <td className="num">{formatCents(p.priceCents)}</td>
                <td className={`num ${p.stock <= p.minStock ? "low" : ""}`}>
                  {p.stock} {p.unit}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}
