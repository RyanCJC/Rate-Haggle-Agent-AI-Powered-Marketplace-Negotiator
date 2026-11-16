import * as Lucide from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import styles from "./icon.module.css";

export type IconName = keyof typeof Lucide;

type LucideIconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "size"> {
  name: IconName;
  size?: number | string;
}

export function Icon({ name, size = 16, ...props }: IconProps) {
  const Component = Lucide[name] as LucideIconComponent;
  return <Component size={size} className={styles.icon} {...props} />;
}
