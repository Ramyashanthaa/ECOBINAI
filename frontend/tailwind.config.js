/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      animation: {
        "lid-open": "lidOpen 0.4s ease-out forwards",
        "lid-close": "lidClose 0.4s ease-in forwards",
        "pulse-glow": "pulseGlow 2s ease-in-out infinite",
        "slide-up": "slideUp 0.3s ease-out",
        "spin-slow": "spin 3s linear infinite",
      },
      keyframes: {
        lidOpen: {
          "0%": { transform: "rotateX(0deg)", transformOrigin: "top" },
          "100%": { transform: "rotateX(-110deg)", transformOrigin: "top" },
        },
        lidClose: {
          "0%": { transform: "rotateX(-110deg)", transformOrigin: "top" },
          "100%": { transform: "rotateX(0deg)", transformOrigin: "top" },
        },
        pulseGlow: {
          "0%, 100%": { boxShadow: "0 0 5px currentColor" },
          "50%": { boxShadow: "0 0 20px currentColor, 0 0 40px currentColor" },
        },
        slideUp: {
          "0%": { transform: "translateY(20px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
