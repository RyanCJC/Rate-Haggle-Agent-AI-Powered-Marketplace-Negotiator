import type { ButtonHTMLAttributes, ForwardedRef } from "react";
import { forwardRef } from "react";
import { Icon } from "../icon/icon";
import styles from "./button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  pressed?: boolean;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: styles.buttonPrimary,
  secondary: styles.buttonSecondary,
  ghost: styles.buttonGhost,
  danger: styles.buttonDanger,
};

const SIZE: Record<ButtonSize, string> = {
  sm: styles.sizeSm,
  md: styles.sizeMd,
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      loading,
      pressed,
      className,
      children,
      disabled,
      ...props
    }: ButtonProps,
    ref: ForwardedRef<HTMLButtonElement>,
  ) {
    return (
      <button
        ref={ref}
        className={[
          styles.button,
          VARIANT[variant],
          SIZE[size],
          pressed && styles.buttonPressed,
          loading && styles.buttonLoading,
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <>
            <Icon name="Loader" size={16} className={styles.spinner} aria-hidden="true" />
            <span className={styles.visuallyHidden}>Loading</span>
          </>
        ) : (
          children
        )}
      </button>
    );
  },
);

Button.displayName = "Button";

export default Button;
export { Button };
