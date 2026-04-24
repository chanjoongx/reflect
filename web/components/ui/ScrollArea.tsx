import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: "vertical" | "horizontal" | "both";
  maxHeight?: string | number;
}

export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(function ScrollArea(
  { className, children, style, orientation = "vertical", maxHeight, ...props },
  ref
) {
  const overflowClass =
    orientation === "horizontal"
      ? "overflow-x-auto overflow-y-hidden"
      : orientation === "both"
      ? "overflow-auto"
      : "overflow-y-auto overflow-x-hidden";

  return (
    <div
      ref={ref}
      className={cn(
        "relative rounded-lg",
        overflowClass,
        "[scrollbar-gutter:stable]",
        className
      )}
      style={{
        maxHeight: typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight,
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
});
