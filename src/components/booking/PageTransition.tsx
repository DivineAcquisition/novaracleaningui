import { motion } from "framer-motion";
import { ReactNode } from "react";

interface PageTransitionProps {
  children: ReactNode;
  direction?: "forward" | "backward";
}

export function PageTransition({ children, direction = "forward" }: PageTransitionProps) {
  const variants = {
    initial: {
      opacity: 0,
      x: direction === "forward" ? 20 : -20,
    },
    animate: {
      opacity: 1,
      x: 0,
      transition: {
        duration: 0.35,
        ease: [0.25, 0.1, 0.25, 1] as const,
      },
    },
    exit: {
      opacity: 0,
      x: direction === "forward" ? -20 : 20,
      transition: {
        duration: 0.25,
        ease: [0.25, 0.1, 0.25, 1] as const,
      },
    },
  };

  return (
    <motion.div
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="w-full"
    >
      {children}
    </motion.div>
  );
}
