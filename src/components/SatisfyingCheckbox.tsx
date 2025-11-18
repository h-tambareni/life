"use client";

import { useState, useEffect } from "react";

interface SatisfyingCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}

export default function SatisfyingCheckbox({
  checked,
  onChange,
  className = "",
}: SatisfyingCheckboxProps) {
  const [isAnimating, setIsAnimating] = useState(false);
  const [showRipple, setShowRipple] = useState(false);
  const [showParticles, setShowParticles] = useState(false);

  useEffect(() => {
    if (checked) {
      setIsAnimating(true);
      setShowRipple(true);
      setShowParticles(true);
      const timer = setTimeout(() => {
        setIsAnimating(false);
      }, 800);
      const rippleTimer = setTimeout(() => {
        setShowRipple(false);
      }, 500);
      const particlesTimer = setTimeout(() => {
        setShowParticles(false);
      }, 1000);
      return () => {
        clearTimeout(timer);
        clearTimeout(rippleTimer);
        clearTimeout(particlesTimer);
      };
    } else {
      setIsAnimating(false);
      setShowRipple(false);
      setShowParticles(false);
    }
  }, [checked]);

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`
          group relative flex h-7 w-7 items-center justify-center rounded-lg border-2 transition-all duration-300 ease-out
          ${
            checked
              ? "border-[#3f6b4a] bg-gradient-to-br from-[#3f6b4a] to-[#2f4d35] shadow-lg shadow-[#3f6b4a]/40"
              : "border-[#d0c0a0] bg-transparent hover:border-[#b99c6b] hover:bg-[#f5ecdd]/50 active:scale-95"
          }
          ${isAnimating ? "scale-125" : checked ? "scale-100" : "scale-100"}
        `}
        aria-label={checked ? "Mark as incomplete" : "Mark as complete"}
      >
        {/* Multiple ripple effects */}
        {showRipple && (
          <>
            <div className="absolute inset-0 animate-ping rounded-lg bg-[#3f6b4a] opacity-60" />
            <div
              className="absolute inset-0 animate-ping rounded-lg bg-[#3f6b4a] opacity-40"
              style={{ animationDelay: "0.15s" }}
            />
          </>
        )}

        {/* Glow effect */}
        {checked && (
          <div className="absolute inset-0 rounded-lg bg-[#3f6b4a] opacity-20 blur-md" />
        )}

        {/* Checkmark with draw animation */}
        <svg
          className={`
            h-5 w-5 text-white transition-all duration-300
            ${checked ? "scale-100 opacity-100" : "scale-0 opacity-0"}
            ${isAnimating ? "rotate-12" : "rotate-0"}
          `}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          viewBox="0 0 24 24"
        >
          <path
            d="M20 6L9 17l-5-5"
            style={{
              strokeDasharray: 20,
              strokeDashoffset: checked ? 0 : 20,
              transition: "stroke-dashoffset 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          />
        </svg>

        {/* Sparkle particles */}
        {showParticles && (
          <>
            {[...Array(8)].map((_, i) => {
              const angle = (i * 360) / 8;
              const distance = 16;
              return (
                <div
                  key={i}
                  className="absolute h-1.5 w-1.5 animate-sparkle rounded-full bg-gradient-to-br from-[#f4efe6] to-[#c79b45] shadow-sm"
                  style={{
                    left: "50%",
                    top: "50%",
                    transform: `translate(-50%, -50%)`,
                    animationDelay: `${i * 0.05}s`,
                    animationDuration: "0.8s",
                    "--sparkle-angle": `${angle}deg`,
                    "--sparkle-distance": `${distance}px`,
                  } as React.CSSProperties & { "--sparkle-angle": string; "--sparkle-distance": string }}
                />
              );
            })}
          </>
        )}

        {/* Bounce effect on click */}
        {isAnimating && (
          <div className="absolute inset-0 rounded-lg border-2 border-[#3f6b4a] animate-bounce-in" />
        )}
      </button>

      <style jsx>{`
        @keyframes sparkle {
          0% {
            opacity: 1;
            transform: translate(-50%, -50%) rotate(var(--sparkle-angle)) translateY(0) scale(1);
          }
          50% {
            opacity: 1;
            transform: translate(-50%, -50%) rotate(var(--sparkle-angle)) translateY(calc(-1 * var(--sparkle-distance))) scale(1.2);
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -50%) rotate(var(--sparkle-angle)) translateY(calc(-1.5 * var(--sparkle-distance))) scale(0);
          }
        }
        .animate-sparkle {
          animation: sparkle 0.8s cubic-bezier(0.4, 0, 0.2, 1) forwards;
        }
        @keyframes bounce-in {
          0% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.3);
            opacity: 0.8;
          }
          100% {
            transform: scale(1.5);
            opacity: 0;
          }
        }
        .animate-bounce-in {
          animation: bounce-in 0.6s ease-out forwards;
        }
      `}</style>
    </div>
  );
}

