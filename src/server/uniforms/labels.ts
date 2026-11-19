/** Display labels for uniform enums (safe to import from client components). */
export const CATEGORIES = ["SHIRT", "PANT", "SKIRT", "SHORTS", "SHOES", "SOCKS", "BELT", "TIE", "ID_CARD", "SWEATER", "BADGE", "OTHER"] as const;
export type UniformCategoryKey = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<UniformCategoryKey, string> = {
  SHIRT: "Shirt", PANT: "Pant", SKIRT: "Skirt", SHORTS: "Shorts", SHOES: "Shoes", SOCKS: "Socks",
  BELT: "Belt", TIE: "Tie", ID_CARD: "ID card", SWEATER: "Sweater", BADGE: "Badge", OTHER: "Other",
};

export const UNIFORM_GENDERS = ["BOY", "GIRL", "UNISEX"] as const;
export type UniformGenderKey = (typeof UNIFORM_GENDERS)[number];
export const GENDER_LABELS: Record<UniformGenderKey, string> = { BOY: "Boys", GIRL: "Girls", UNISEX: "Unisex" };

export const ORDER_STATUSES = ["ORDERED", "PAID", "READY", "DELIVERED", "CANCELLED"] as const;
export const ORDER_FLOW = ["ORDERED", "PAID", "READY", "DELIVERED"] as const;
export const OPEN_STATUSES = ["ORDERED", "PAID", "READY"] as const;
/** Orders whose stock has not been deducted yet (stock is deducted when the order is marked Ready). */
export const UNDEDUCTED_STATUSES = ["ORDERED", "PAID"] as const;

export const MOVEMENT_LABELS: Record<string, string> = {
  OPENING: "Opening stock", PURCHASE: "Purchase", ORDER_OUT: "Order (ready)", RETURN_IN: "Return / cancel",
  EXCHANGE_IN: "Exchange in", EXCHANGE_OUT: "Exchange out", DAMAGE: "Damage", ADJUSTMENT: "Adjustment",
};

export const PAYMENT_MODES = ["CASH", "UPI", "CARD", "CHEQUE", "NETBANKING", "BANK_TRANSFER"] as const;
export const MODE_LABELS: Record<string, string> = { CASH: "Cash", UPI: "UPI", CARD: "Card", CHEQUE: "Cheque", NETBANKING: "Net banking", BANK_TRANSFER: "Bank transfer" };
