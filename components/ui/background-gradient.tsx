"use client";

import { motion } from "framer-motion";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type BackgroundGradientProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function BackgroundGradient({ children, className, ...props }: BackgroundGradientProps) {
  return (
    <div className={cn("group relative rounded-2xl p-[1px]", className)} {...props}>
      <motion.div
        className="absolute inset-0 rounded-2xl bg-gradient-to-r from-cyan-500 via-blue-500 to-emerald-400 opacity-85 blur-xl"
        animate={{ rotate: [0, 3, -3, 0], scale: [1, 1.02, 1] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="relative rounded-[15px] border border-white/10 bg-slate-950/95">
        {children}
      </div>
    </div>
  );
}
