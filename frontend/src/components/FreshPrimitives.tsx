"use client";

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type FreshButtonVariant = "primary" | "secondary" | "text" | "danger";

export function FreshButton({
  variant = "primary",
  className = "",
  children,
  trailing,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: FreshButtonVariant;
  trailing?: ReactNode;
}) {
  const classes = [`fresh-button`, `fresh-button--${variant}`, className].filter(Boolean).join(" ");
  return <button type={type} className={classes} {...props}>{children}{trailing ? <span aria-hidden="true">{trailing}</span> : null}</button>;
}

export function BackButton({ className = "", label = "返回上一页", ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & { label?: string }) {
  return <button type="button" className={["fresh-icon-button", "back-button", className].filter(Boolean).join(" ")} aria-label={label} {...props}><span aria-hidden="true">←</span></button>;
}

export function FreshSurface({ className = "", children, ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return <section className={["fresh-surface", className].filter(Boolean).join(" ")} {...props}>{children}</section>;
}
