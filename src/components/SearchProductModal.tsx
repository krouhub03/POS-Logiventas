import { useState, useEffect, useRef } from "react";
import { api } from "../services/api";
import { formatCents } from "../lib/money";
import type { Product } from "../types";

interface SearchProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (product: Product) => void;
}

export function SearchProductModal({
  isOpen,
  onClose,
  onSelect,
}: SearchProductModalProps) {
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSearch("");
      setSelectedIndex(0);
      setProducts([]);
      setTimeout(() => inputRef.current?.focus(), 50);
      // Cargar lista inicial
      api.products.list("").then((res) => setProducts(res)).catch(console.error);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => {
      setLoading(true);
      api.products
        .list(search)
        .then((list) => {
          setProducts(list);
          setSelectedIndex(0);
        })
        .finally(() => setLoading(false));
    }, 150);
    return () => clearTimeout(t);
  }, [search, isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, products.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (products[selectedIndex]) {
        onSelect(products[selectedIndex]);
        onClose();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h2 style={styles.title}>Buscar Producto [F10]</h2>
          <button type="button" onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        <div style={styles.searchBar}>
          <input
            ref={inputRef}
            style={styles.searchInput}
            placeholder="Escribe nombre, código de barras o SKU… (Usa ↑ ↓ para navegar)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>

        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>SKU / Código</th>
                <th style={styles.th}>Descripción</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Precio</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Existencia</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 ? (
                <tr>
                  <td colSpan={4} style={styles.empty}>
                    {loading ? "Buscando productos…" : "No se encontraron productos"}
                  </td>
                </tr>
              ) : (
                products.map((p, idx) => (
                  <tr
                    key={p.id}
                    style={{
                      ...styles.tr,
                      ...(idx === selectedIndex ? styles.trSelected : {}),
                    }}
                    onClick={() => {
                      onSelect(p);
                      onClose();
                    }}
                  >
                    <td style={styles.tdMono}>{p.barcode || p.sku}</td>
                    <td style={styles.tdName}>{p.name}</td>
                    <td style={{ ...styles.td, textAlign: "right", color: "#60a5fa", fontWeight: "bold" }}>
                      {formatCents(p.priceCents)}
                    </td>
                    <td style={{ ...styles.td, textAlign: "right" }}>
                      <span style={p.stock <= p.minStock ? { color: "#ef4444", fontWeight: "bold" } : {}}>
                        {p.stock} {p.unit}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div style={styles.footer}>
          <span style={styles.hint}>
            [↑ ↓] Seleccionar · [Enter] Agregar a Venta · [Esc] Salir
          </span>
          <button type="button" onClick={onClose} style={styles.closeActionBtn}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0, 0, 0, 0.75)",
    backdropFilter: "blur(4px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  },
  modal: {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: "16px",
    width: "100%",
    maxWidth: "750px",
    maxHeight: "85vh",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.6)",
    color: "#f8fafc",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "1rem 1.5rem",
    borderBottom: "1px solid #334155",
    background: "#0f172a",
  },
  title: {
    margin: 0,
    fontSize: "1.2rem",
    fontWeight: "bold",
  },
  closeBtn: {
    background: "transparent",
    border: "none",
    color: "#94a3b8",
    fontSize: "1.2rem",
    cursor: "pointer",
  },
  searchBar: {
    padding: "1rem 1.5rem",
    borderBottom: "1px solid #334155",
    background: "#1e293b",
  },
  searchInput: {
    width: "100%",
    background: "#0f172a",
    border: "2px solid #3b82f6",
    borderRadius: "8px",
    padding: "0.75rem 1rem",
    fontSize: "1.05rem",
    color: "#f8fafc",
    outline: "none",
    boxSizing: "border-box",
  },
  tableContainer: {
    flex: 1,
    overflowY: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.9rem",
  },
  th: {
    background: "#0f172a",
    padding: "0.75rem 1rem",
    color: "#94a3b8",
    fontSize: "0.75rem",
    textTransform: "uppercase",
    borderBottom: "1px solid #334155",
    textAlign: "left",
  },
  tr: {
    cursor: "pointer",
    borderBottom: "1px solid #334155",
    transition: "background 0.1s ease",
  },
  trSelected: {
    background: "#2563eb !important",
    color: "#ffffff !important",
  },
  td: {
    padding: "0.75rem 1rem",
  },
  tdMono: {
    padding: "0.75rem 1rem",
    fontFamily: "monospace",
    color: "#94a3b8",
  },
  tdName: {
    padding: "0.75rem 1rem",
    fontWeight: 600,
  },
  empty: {
    textAlign: "center",
    padding: "3rem",
    color: "#64748b",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0.75rem 1.5rem",
    borderTop: "1px solid #334155",
    background: "#0f172a",
  },
  hint: {
    fontSize: "0.8rem",
    color: "#94a3b8",
  },
  closeActionBtn: {
    background: "#334155",
    border: "none",
    borderRadius: "6px",
    color: "#e2e8f0",
    padding: "0.4rem 0.8rem",
    fontSize: "0.85rem",
    cursor: "pointer",
  },
};
