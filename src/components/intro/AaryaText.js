import { motion } from 'framer-motion';
import styles from './IntroContainer.module.css';

export default function AaryaText({ isVisible, onComplete }) {
  const letters = ['A', 'A', 'R', 'Y', 'A'];

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05, // Very tight stagger
        delayChildren: 0.4, // Synced closer to the fast meteoroid
      }
    },
    exit: {
      opacity: 0,
      transition: { duration: 0.2 }
    }
  };

  const letterVariants = {
    hidden: { 
      opacity: 0,
      scale: 0.95, // Subtle scale
    },
    visible: {
      opacity: 1,
      scale: 1,
      transition: {
        duration: 0.4,
        ease: "easeOut"
      }
    }
  };

  return (
    <motion.div 
      className={styles.textContainer}
      variants={containerVariants}
      initial="hidden"
      animate={isVisible ? "visible" : "exit"}
      onAnimationComplete={(definition) => {
        if (definition === "visible" && onComplete) {
          // Fire complete shortly after full reveal
          setTimeout(onComplete, 400);
        }
      }}
    >
      {letters.map((char, i) => (
        <motion.span key={i} className={styles.letter} variants={letterVariants}>
          {char}
        </motion.span>
      ))}
    </motion.div>
  );
}
