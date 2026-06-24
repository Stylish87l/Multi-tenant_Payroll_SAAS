import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { motion, useMotionTemplate, useMotionValue } from 'framer-motion';

const Card = ({ children, className = '', onClick }) => {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  function handleMouseMove({ currentTarget, clientX, clientY }) {
    const { left, top } = currentTarget.getBoundingClientRect();
    mouseX.set(clientX - left);
    mouseY.set(clientY - top);
  }

  function handleKeyDown(e) {
    if (onClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onClick(e);
    }
  }

  const background = useMotionTemplate`
    radial-gradient(
      600px circle at ${mouseX}px ${mouseY}px,
      rgba(255, 255, 255, 0.1),
      transparent 80%
    )
  `;

  return (
    <motion.div
      onMouseMove={handleMouseMove}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      tabIndex={onClick ? 0 : -1}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ willChange: 'transform' }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className={`
        relative group overflow-hidden
        rounded-2xl border border-white/10 
        bg-slate-900/50 backdrop-blur-xl 
        transition-colors duration-500 hover:border-white/20
        ${onClick ? 'cursor-pointer active:scale-[0.98]' : ''}
        ${className}
      `}
      role={onClick ? 'button' : 'region'}
      aria-label="Content Card"
      data-testid="card-component"
    >
      <motion.div
        className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 transition duration-300 group-hover:opacity-100"
        style={{ background }}
      />
      <div className="relative z-10 p-4 md:p-6 text-slate-200">
        {children}
      </div>
      <div className="absolute bottom-0 left-0 h-[1px] w-full bg-gradient-to-r from-transparent via-white/20 to-transparent" />
    </motion.div>
  );
};

Card.propTypes = {
  children: PropTypes.oneOfType([PropTypes.node, PropTypes.string]).isRequired,
  className: PropTypes.string,
  onClick: PropTypes.func,
};

export default React.memo(Card);
