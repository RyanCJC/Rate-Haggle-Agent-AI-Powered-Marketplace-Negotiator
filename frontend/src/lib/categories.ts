import type { ListingCategory } from "../types";

export const CATEGORIES: { value: ListingCategory; label: string }[] = [
  { value: "monitors", label: "Monitor" },
  { value: "phones", label: "Phone" },
  { value: "laptops", label: "Laptop" },
  { value: "cameras", label: "Camera" },
  { value: "consoles", label: "Game console" },
  { value: "furniture", label: "Furniture" },
  { value: "appliances", label: "Home appliance" },
  { value: "other", label: "Other" },
];

export function categoryLabel(value: string): string {
  const found = CATEGORIES.find((c) => c.value === value);
  return found ? found.label : value;
}
