const colors = require('tailwindcss/colors');

module.exports = {
  // src/components holds shared components the pages use (search boxes, forms):
  // without it, classes only they use are never generated.
  content: [
    './src/renderer/**/*.{js,jsx,ts,tsx,ejs}',
    './src/components/**/*.{js,jsx,ts,tsx}',
  ],
  darkMode: false,
  theme: {
    extend: {
      colors: {
        sky: colors.sky,
        cyan: colors.cyan,
      },
      animation: {
        'loading-bar': 'loading-bar 1.5s linear infinite',
      },
      keyframes: {
        'loading-bar': {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
      },
    },
  },
  variants: {
    extend: {},
  },
  plugins: [],
};
