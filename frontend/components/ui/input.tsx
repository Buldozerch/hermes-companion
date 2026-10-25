import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-xs border border-input bg-background px-2.5 py-1 font-mono text-xs transition-[background-color,border-color] duration-100 ease-out selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-xs file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40",
        "focus-visible:border-foreground focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "aria-invalid:border-foreground aria-invalid:border-dashed",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
