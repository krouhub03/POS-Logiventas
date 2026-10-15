import type { ProductTag } from "../types";

/**
 * Parsea y normaliza la cadena de etiquetas separada por comas sin romper
 * nombres compuestos con espacios como "Más Vendido", "Promo 2x1" o "Vegano / Orgánico".
 * Recombina fragmentaciones accidentales usando la lista de etiquetas maestras (knownTags).
 */
export function parseTags(
  tagsStr: string | null | undefined,
  knownTags?: ProductTag[]
): string[] {
  if (!tagsStr || !tagsStr.trim()) return [];

  let tokens: string[];
  if (tagsStr.includes(",") || tagsStr.includes(";")) {
    tokens = tagsStr
      .split(/[,;]+/)
      .map((t) => t.trim().replace(/^#/, ""))
      .filter(Boolean);
  } else {
    const clean = tagsStr.trim().replace(/^#/, "");
    tokens = clean ? [clean] : [];
  }

  if (knownTags && knownTags.length > 0 && tokens.length > 1) {
    const healed: string[] = [];
    let i = 0;
    while (i < tokens.length) {
      let matched = false;
      if (i + 1 < tokens.length) {
        const combined = `${tokens[i]} ${tokens[i + 1]}`.toLowerCase();
        const found = knownTags.find((kt) => kt.name.toLowerCase() === combined);
        if (found) {
          healed.push(found.name);
          i += 2;
          matched = true;
        }
      }
      if (!matched) {
        healed.push(tokens[i]);
        i++;
      }
    }
    return healed;
  }

  return tokens;
}
