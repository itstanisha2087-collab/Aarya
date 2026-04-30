import { motion } from 'framer-motion';
import styles from './IntroContainer.module.css';

export default function AaryaTextReveal({ isVisible, onComplete }) {
  const letters = ['A', 'A', 'R', 'Y', 'A'];

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1, // Fast stagger
        delayChildren: 1.2, // Trigger as comet starts center loop
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
      scale: 0.9,
      y: 20
    },
    visible: {
      opacity: 1,
      scale: 1,
      y: 0,
      transition: {
        duration: 0.6,
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
          // Wait for the comet to exit before dissolving
          // The comet animation is 3.5s. Text starts at 1.2s, finishes around 2.0s.
          // Wait another 1.5s so it dissolves exactly as the comet exits.
          setTimeout(onComplete, 1500);
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
