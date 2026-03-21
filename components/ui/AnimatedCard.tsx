"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Card } from "tdesign-react";

type AnimatedCardProps = {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  hoverScale?: number;
};

export function AnimatedCard({
  children,
  delay = 0,
  className = "",
  hoverScale = 1.02
}: AnimatedCardProps) {
  const shouldReduceMotion = useReducedMotion() ?? false;

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0, y: 20 }}
      animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.4, delay, ease: "easeOut" }}
      whileHover={shouldReduceMotion ? undefined : { scale: hoverScale, y: -2 }}
      className={className}
    >
      <Card className="tc-panel">{children}</Card>
    </motion.div>
  );
}
