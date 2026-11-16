import type { HTMLAttributes } from "react";
import styles from "./badge.module.css";

export type BadgeVariant = "default" | "success" | "warning" | "danger" | "neutral";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const VARIANT: Record<BadgeVariant, string | undefined> = {
  default: undefined,
  success: styles.badgeSuccess,
  warning: styles.badgeWarning,
  danger: styles.badgeDanger,
  neutral: styles.badgeNeutral,
};

export function Badge({ variant = "default", className, ...props }: BadgeProps) {
  return (
    <span className={[styles.badge, VARIANT[variant], className].filter(Boolean).join(" ")} {...props} />
  );
}
