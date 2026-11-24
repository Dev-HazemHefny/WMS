import type { UnitInput, VariantDraft } from "../../src/shared/catalog/types";

export const units = {
  piece: { name: "Piece", symbol: "pc", dimension: "count" },
  pack: { name: "Pack", symbol: "pk", dimension: "count" },
  carton: { name: "Carton", symbol: "ctn", dimension: "count" },
  kilogram: { name: "Kilogram", symbol: "kg", dimension: "mass" },
  gram: { name: "Gram", symbol: "g", dimension: "mass" },
  liter: { name: "Liter", symbol: "L", dimension: "volume" },
  milliliter: { name: "Milliliter", symbol: "mL", dimension: "volume" },
  meter: { name: "Meter", symbol: "m", dimension: "length" },
  roll: { name: "Cable roll", symbol: "roll", dimension: "length" },
} satisfies Record<string, UnitInput>;

type Group = {
  code: string;
  name: string;
  aisle: string;
  brand: string;
  products: readonly ProductExample[];
};
type ProductExample = readonly [
  code: string, name: string, unit?: "piece" | "kilogram" | "liter" | "meter",
  variantKey?: string, variants?: readonly string[],
];

export const groups: readonly Group[] = [
  {
    code: "ELEC", name: "Electronics", aisle: "Power and accessories", brand: "Delta Circuit",
    products: [
      ["USB-C", "Braided USB-C Cable", "piece", "Length", ["1 m", "2 m", "3 m"]],
      ["CHG", "USB-C Wall Charger 45 W"],
      ["HUB", "USB-C Hub 7-Port"],
      ["MOUSE", "Wireless Mouse", "piece", "Color", ["Black", "White", "Graphite"]],
      ["KEY", "Compact Wired Keyboard"],
      ["HDMI", "HDMI Cable 2 m"],
      ["UPS", "Desktop UPS 650 VA"],
      ["ETH", "Cat6 Patch Cable 5 m"],
      ["SSD", "Portable SSD 1 TB"],
      ["BAT", "Rechargeable AA Battery"],
      ["CASE", "Padded Tablet Sleeve 11 inch"],
    ],
  },
  {
    code: "FOOD", name: "Food", aisle: "Dry goods and oils", brand: "Nile Pantry",
    products: [
      ["RICE", "Jasmine Rice", "kilogram"],
      ["LENTIL", "Red Lentils", "kilogram"],
      ["OIL", "Sunflower Oil", "liter"],
      ["DATES", "Pitted Dates", "kilogram"],
      ["PASTA", "Penne Pasta 500 g"],
      ["TOMATO", "Tomato Paste 135 g"],
      ["TEA", "Black Tea 25 Bags"],
      ["COFFEE", "Roasted Coffee Beans", "kilogram"],
      ["OATS", "Rolled Oats 1 kg"],
      ["SALT", "Iodized Salt 500 g"],
      ["BEANS", "Canned Fava Beans 400 g"],
    ],
  },
  {
    code: "BUILD", name: "Construction", aisle: "Site materials", brand: "Cairo Site Supply",
    products: [
      ["WIRE", "Copper Electrical Wire", "meter"],
      ["GROUT", "Grey Tile Grout", "kilogram"],
      ["SEAL", "Acrylic Sealant 300 mL"],
      ["BOLT", "Hex Bolt", "piece", "Size", ["M6 × 25", "M8 × 40", "M10 × 50"]],
      ["TAPE", "PTFE Thread Seal Tape"],
      ["PIPE", "PVC Pipe 25 mm", "meter"],
      ["ELBOW", "PVC Elbow 25 mm"],
      ["GLOVE", "Cut-Resistant Gloves", "piece", "Size", ["Medium", "Large", "Extra large"]],
      ["PRIMER", "Water-Based Primer", "liter"],
      ["MASK", "Dust Mask FFP2"],
      ["GOG", "Clear Safety Goggles"],
    ],
  },
  {
    code: "OFFICE", name: "Office Supplies", aisle: "Paper and stationery", brand: "Alexandria Stationers",
    products: [
      ["PAPER", "A4 Copy Paper 500 Sheets"],
      ["NOTE", "A5 Ruled Notebook"],
      ["PEN", "Blue Ballpoint Pen"],
      ["LABEL", "Thermal Labels 58 × 40 mm"],
      ["FOLDER", "A4 Lever Arch File"],
      ["CLIP", "Binder Clips 32 mm"],
      ["STAPLER", "Desktop Stapler"],
      ["MARKER", "Black Whiteboard Marker"],
      ["ENVELOPE", "Kraft Envelope C4"],
      ["PAD", "Yellow Repositionable Notes"],
      ["TRAY", "Wire Document Tray"],
    ],
  },
];

export function makeVariants(
  sku: string, attribute: string, values: readonly string[],
  packaging: NonNullable<VariantDraft["packaging"]>, nextBarcode: () => string,
): VariantDraft[] {
  return values.map((value, index) => ({
    name: value,
    sku: `${sku}-${index + 1}`,
    attributes: [{ name: attribute, value }],
    packaging,
    barcodes: [{ code: nextBarcode() }, { code: nextBarcode(), packagingUnitId: packaging[0].unitId }],
  }));
}
