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
    },
    animate: {
      opacity: 1,
      transition: {
        duration: 0.2,
        ease: "easeOut" as const,
      },
    },
    exit: {
      opacity: 0,
      transition: {
        duration: 0.15,
        ease: "easeIn" as const,
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
