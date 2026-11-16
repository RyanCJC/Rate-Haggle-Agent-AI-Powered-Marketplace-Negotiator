import type { HTMLAttributes } from "react";
import styles from "./skeleton.module.css";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  width?: string | number;
  height?: string | number;
}

export function Skeleton({ width, height, className, ...props }: SkeletonProps) {
  return (
    <div
      className={[styles.skeleton, className].filter(Boolean).join(" ")}
      style={{ width, height }}
      {...props}
    />
  );
}
