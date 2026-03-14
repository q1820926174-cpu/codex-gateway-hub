"use client";

import { motion } from "framer-motion";
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
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: "easeOut" }}
      whileHover={{ scale: hoverScale, y: -2 }}
      className={className}
    >
      <Card className="tc-panel">{children}</Card>
    </motion.div>
  );
}
