import type { SVGProps } from "react";
import styles from "./logo.module.css";

export interface LogoProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
}

export function Logo({ size = 32, className, ...props }: LogoProps) {
  return (
    <svg
      className={[styles.logo, className].filter(Boolean).join(" ")}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <rect x="6" y="6" width="22" height="16" rx="4" ry="4" fill="var(--color-primary)" />
      <path d="M12 22 L8 28 L16 24 Z" fill="var(--color-primary)" />
      <circle cx="24" cy="10" r="2.5" fill="var(--color-gold)" />
    </svg>
  );
}
