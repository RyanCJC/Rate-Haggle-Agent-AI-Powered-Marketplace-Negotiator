import type { HTMLAttributes } from "react";
import styles from "./card.module.css";

export type CardPadding = "none" | "sm" | "md" | "lg";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
}

const PADDING: Record<CardPadding, string> = {
  none: "",
  sm: styles.padSm,
  md: styles.padMd,
  lg: styles.padLg,
};

export function Card({ padding = "md", className, ...props }: CardProps) {
  return (
    <div className={[styles.card, PADDING[padding], className].filter(Boolean).join(" ")} {...props} />
  );
}
