// Generated from core/spec/app-icons.json and core/spec/icon by desktop/scripts/icons.mjs. Edit those, not this file.
export const APP_ICONS = {
  "description": "The app icon choices Settings offers (appearance.appIcon, issues 167 and 189). Follow theme, the default, is the icon issue 189 draws: the Flor de muerto masters coloured from the active theme's tokens, redrawn by the desktop shell whenever the theme changes, and on the phones the store icon in the default theme, since neither can recolour an installed icon. Every other choice is a fixed palette: the seven tokens the icon reads (core/app/rules/icon.js ICON_TOKENS) and the scheme they are drawn in, put through the same iconPalette and renderIcon as the theme's, so a fixed icon is the same glyph in other colours and never a second drawing. desktop/scripts/icons.mjs draws each fixed palette for every platform: the picture Settings shows (core/app/assets/app-icons), an iOS alternate icon set, an Android adaptive icon with its launcher colour, and core/app/rules/app-icons-spec.js, the page's mirror of this file. pnpm run build fails when a generated copy is stale.",
  "default": "theme",
  "icons": [
    {
      "id": "theme",
      "label": "Follow theme"
    },
    {
      "id": "teal",
      "label": "Teal",
      "scheme": "light",
      "colors": {
        "accent": "#156c68",
        "accent-fg": "#ffffff",
        "fg": "#13201f",
        "bg": "#f7faf9",
        "bg-raised": "#ffffff",
        "danger": "#b91c1c",
        "danger-fg": "#ffffff"
      }
    },
    {
      "id": "night",
      "label": "Night",
      "scheme": "dark",
      "colors": {
        "accent": "#4fd1c5",
        "accent-fg": "#0b1615",
        "fg": "#e8f3f1",
        "bg": "#0b1615",
        "bg-raised": "#13221f",
        "danger": "#f87171",
        "danger-fg": "#0b1615"
      }
    },
    {
      "id": "paper",
      "label": "Paper",
      "scheme": "light",
      "colors": {
        "accent": "#efe7d8",
        "accent-fg": "#8a3324",
        "fg": "#2b241c",
        "bg": "#fbf8f2",
        "bg-raised": "#ffffff",
        "danger": "#b91c1c",
        "danger-fg": "#ffffff"
      }
    }
  ]
};

// The Flor de muerto masters (core/spec/icon), read by rules/icon.js parseGlyph.
export const ICON_MASTERS = {
  full: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><defs><mask id=\"g0f\" maskUnits=\"userSpaceOnUse\" x=\"-10\" y=\"-10\" width=\"120\" height=\"120\"><rect x=\"-10\" y=\"-10\" width=\"120\" height=\"120\" fill=\"white\"/><g fill=\"black\"><path transform=\"translate(32 54) rotate(0)\" d=\"M0,-1.48 Q3.10,-4.44 0,-7.4 Q-3.10,-4.44 0,-1.48Z\"/><path transform=\"translate(32 54) rotate(60)\" d=\"M0,-1.48 Q3.10,-4.44 0,-7.4 Q-3.10,-4.44 0,-1.48Z\"/><path transform=\"translate(32 54) rotate(120)\" d=\"M0,-1.48 Q3.10,-4.44 0,-7.4 Q-3.10,-4.44 0,-1.48Z\"/><path transform=\"translate(32 54) rotate(180)\" d=\"M0,-1.48 Q3.10,-4.44 0,-7.4 Q-3.10,-4.44 0,-1.48Z\"/><path transform=\"translate(32 54) rotate(240)\" d=\"M0,-1.48 Q3.10,-4.44 0,-7.4 Q-3.10,-4.44 0,-1.48Z\"/><path transform=\"translate(32 54) rotate(300)\" d=\"M0,-1.48 Q3.10,-4.44 0,-7.4 Q-3.10,-4.44 0,-1.48Z\"/><circle cx=\"32\" cy=\"54\" r=\"2.22\"/><circle cx=\"32\" cy=\"54\" r=\"1.18\" fill=\"white\"/><path transform=\"translate(50 54) rotate(0)\" d=\"M0,-1.48 Q3.10,-4.44 0,-7.4 Q-3.10,-4.44 0,-1.48Z\"/><path transform=\"translate(50 54) rotate(60)\" d=\"M0,-1.48 Q3.10,-4.44 0,-7.4 Q-3.10,-4.44 0,-1.48Z\"/><path transform=\"translate(50 54) rotate(120)\" d=\"M0,-1.48 Q3.10,-4.44 0,-7.4 Q-3.10,-4.44 0,-1.48Z\"/><path transform=\"translate(50 54) rotate(180)\" d=\"M0,-1.48 Q3.10,-4.44 0,-7.4 Q-3.10,-4.44 0,-1.48Z\"/><path transform=\"translate(50 54) rotate(240)\" d=\"M0,-1.48 Q3.10,-4.44 0,-7.4 Q-3.10,-4.44 0,-1.48Z\"/><path transform=\"translate(50 54) rotate(300)\" d=\"M0,-1.48 Q3.10,-4.44 0,-7.4 Q-3.10,-4.44 0,-1.48Z\"/><circle cx=\"50\" cy=\"54\" r=\"2.22\"/><circle cx=\"50\" cy=\"54\" r=\"1.18\" fill=\"white\"/><path transform=\"translate(41 64.5) scale(1)\" d=\"M0,-3.6 C2.5,-1.1 4.5,0.9 3,2.9 C2,4.2 0.6,3.7 0,2.7 C-0.6,3.7 -2,4.2 -3,2.9 C-4.5,0.9 -2.5,-1.1 0,-3.6Z\"/><rect x=\"31\" y=\"71\" width=\"20\" height=\"3.4\" rx=\"1.7\"/><rect x=\"34.4\" y=\"70\" width=\"1.2\" height=\"5.4\" fill=\"white\"/><rect x=\"38.4\" y=\"70\" width=\"1.2\" height=\"5.4\" fill=\"white\"/><rect x=\"42.4\" y=\"70\" width=\"1.2\" height=\"5.4\" fill=\"white\"/><rect x=\"46.4\" y=\"70\" width=\"1.2\" height=\"5.4\" fill=\"white\"/><circle cx=\"27\" cy=\"63\" r=\"1.4\"/><circle cx=\"55\" cy=\"63\" r=\"1.4\"/></g></mask><mask id=\"g0b\" maskUnits=\"userSpaceOnUse\" x=\"-10\" y=\"-10\" width=\"120\" height=\"120\"><rect x=\"-10\" y=\"-10\" width=\"120\" height=\"120\" fill=\"white\"/><g fill=\"black\" stroke=\"black\" stroke-width=\"10\" stroke-linejoin=\"round\"><circle cx=\"41\" cy=\"58\" r=\"26\"/><path d=\"M24,76 L13,90 L37,82Z\"/></g><g fill=\"black\"><path transform=\"translate(62 29.5) rotate(0)\" d=\"M0,-1.04 Q2.18,-3.12 0,-5.2 Q-2.18,-3.12 0,-1.04Z\"/><path transform=\"translate(62 29.5) rotate(60)\" d=\"M0,-1.04 Q2.18,-3.12 0,-5.2 Q-2.18,-3.12 0,-1.04Z\"/><path transform=\"translate(62 29.5) rotate(120)\" d=\"M0,-1.04 Q2.18,-3.12 0,-5.2 Q-2.18,-3.12 0,-1.04Z\"/><path transform=\"translate(62 29.5) rotate(180)\" d=\"M0,-1.04 Q2.18,-3.12 0,-5.2 Q-2.18,-3.12 0,-1.04Z\"/><path transform=\"translate(62 29.5) rotate(240)\" d=\"M0,-1.04 Q2.18,-3.12 0,-5.2 Q-2.18,-3.12 0,-1.04Z\"/><path transform=\"translate(62 29.5) rotate(300)\" d=\"M0,-1.04 Q2.18,-3.12 0,-5.2 Q-2.18,-3.12 0,-1.04Z\"/><circle cx=\"62\" cy=\"29.5\" r=\"1.56\"/><circle cx=\"62\" cy=\"29.5\" r=\"0.83\" fill=\"white\"/><path transform=\"translate(75 32.5) rotate(0)\" d=\"M0,-1.04 Q2.18,-3.12 0,-5.2 Q-2.18,-3.12 0,-1.04Z\"/><path transform=\"translate(75 32.5) rotate(60)\" d=\"M0,-1.04 Q2.18,-3.12 0,-5.2 Q-2.18,-3.12 0,-1.04Z\"/><path transform=\"translate(75 32.5) rotate(120)\" d=\"M0,-1.04 Q2.18,-3.12 0,-5.2 Q-2.18,-3.12 0,-1.04Z\"/><path transform=\"translate(75 32.5) rotate(180)\" d=\"M0,-1.04 Q2.18,-3.12 0,-5.2 Q-2.18,-3.12 0,-1.04Z\"/><path transform=\"translate(75 32.5) rotate(240)\" d=\"M0,-1.04 Q2.18,-3.12 0,-5.2 Q-2.18,-3.12 0,-1.04Z\"/><path transform=\"translate(75 32.5) rotate(300)\" d=\"M0,-1.04 Q2.18,-3.12 0,-5.2 Q-2.18,-3.12 0,-1.04Z\"/><circle cx=\"75\" cy=\"32.5\" r=\"1.56\"/><circle cx=\"75\" cy=\"32.5\" r=\"0.83\" fill=\"white\"/><path transform=\"translate(70.5 41) scale(0.7)\" d=\"M0,-3.6 C2.5,-1.1 4.5,0.9 3,2.9 C2,4.2 0.6,3.7 0,2.7 C-0.6,3.7 -2,4.2 -3,2.9 C-4.5,0.9 -2.5,-1.1 0,-3.6Z\"/></g></mask></defs><g mask=\"url(#g0b)\" fill=\"#000\" fill-opacity=\"1\"><circle cx=\"62\" cy=\"38\" r=\"23\"/><path d=\"M76,54 L88,68 L66,59Z\"/></g><g mask=\"url(#g0f)\" fill=\"#000\"><circle cx=\"41\" cy=\"58\" r=\"26\"/><path d=\"M24,76 L13,90 L37,82Z\"/></g></svg>\n",
  small: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"11 13 79 79\"><defs><mask id=\"g1f\" maskUnits=\"userSpaceOnUse\" x=\"-10\" y=\"-10\" width=\"120\" height=\"120\"><rect x=\"-10\" y=\"-10\" width=\"120\" height=\"120\" fill=\"white\"/><g fill=\"black\"><circle cx=\"32\" cy=\"55\" r=\"7.2\"/><circle cx=\"50\" cy=\"55\" r=\"7.2\"/><path transform=\"translate(41 66) scale(1.25)\" d=\"M0,-3.6 C2.5,-1.1 4.5,0.9 3,2.9 C2,4.2 0.6,3.7 0,2.7 C-0.6,3.7 -2,4.2 -3,2.9 C-4.5,0.9 -2.5,-1.1 0,-3.6Z\"/></g></mask><mask id=\"g1b\" maskUnits=\"userSpaceOnUse\" x=\"-10\" y=\"-10\" width=\"120\" height=\"120\"><rect x=\"-10\" y=\"-10\" width=\"120\" height=\"120\" fill=\"white\"/><g fill=\"black\" stroke=\"black\" stroke-width=\"10\" stroke-linejoin=\"round\"><circle cx=\"41\" cy=\"58\" r=\"26\"/><path d=\"M24,76 L13,90 L37,82Z\"/></g><g fill=\"black\"><circle cx=\"62\" cy=\"30\" r=\"4.6\"/><circle cx=\"75\" cy=\"33\" r=\"4.6\"/></g></mask></defs><g mask=\"url(#g1b)\" fill=\"#000\" fill-opacity=\"1\"><circle cx=\"62\" cy=\"38\" r=\"23\"/><path d=\"M76,54 L88,68 L66,59Z\"/></g><g mask=\"url(#g1f)\" fill=\"#000\"><circle cx=\"41\" cy=\"58\" r=\"26\"/><path d=\"M24,76 L13,90 L37,82Z\"/></g></svg>\n",
};
