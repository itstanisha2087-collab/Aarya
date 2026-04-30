import { motion, AnimatePresence } from 'framer-motion';

export default function VoiceReactiveSphere({ isListening }) {
  return (
    <AnimatePresence>
      {isListening && (
        <motion.div
          style={{
            position: 'absolute',
            bottom: '2rem',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            backgroundColor: '#ffffff',
            boxShadow: '0 0 20px rgba(255, 255, 255, 0.8)',
            zIndex: 100,
          }}
          initial={{ opacity: 0, y: 30, scale: 0 }}
          animate={{ 
            opacity: 1, 
            y: 0, 
            scale: [1, 1.2, 1],
            boxShadow: [
              '0 0 20px rgba(255, 255, 255, 0.6)',
              '0 0 40px rgba(255, 255, 255, 1)',
              '0 0 20px rgba(255, 255, 255, 0.6)'
            ]
          }}
          exit={{ opacity: 0, y: 30, scale: 0 }}
          transition={{
            opacity: { duration: 0.3 },
            y: { duration: 0.3, type: 'spring', stiffness: 200 },
            scale: { repeat: Infinity, duration: 2, ease: "easeInOut" },
            boxShadow: { repeat: Infinity, duration: 2, ease: "easeInOut" }
          }}
        />
      )}
    </AnimatePresence>
  );
}
