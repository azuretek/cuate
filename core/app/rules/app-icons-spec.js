// Generated from core/spec/app-icons.json and core/spec/icon by desktop/scripts/icons.mjs. Edit those, not this file.
export const APP_ICONS = {
  "description": "The app icon choices Settings offers (appearance.appIcon; issues 167, 189, 246 and PR 257). Every colour is one family with two variants: a paper variant labelled Light and the bright variant labelled Dark, drawn from the Flor de muerto masters (issue 189) through iconPalette and renderIcon, so a variant is the same glyph in other colours and never a second drawing. Each variant names the seven tokens the icon reads (core/app/rules/icon.js ICON_TOKENS) and the scheme it is drawn in; a colour family's two variants share one name and differ only in their colours. Barro first: its Dark variant is the original terracotta Flor de muerto (the default theme light palette from core/spec/tokens.json, a white glyph on the filled terracotta tile), so the picker, the About picture and every generated asset draw the one colour (PR 257), and Barro Dark is the default; its Light variant is the paper counterpart. Follow theme is not a colour: it draws the icon from the active theme's tokens and takes the Light or Dark rendering from the appearance in force, switching when the appearance does; on the phones it is the store icon in the default theme, since neither can recolour an installed icon. desktop/scripts/icons.mjs draws every variant for every platform: the picture Settings shows (core/app/assets/app-icons), an iOS alternate icon set, an Android adaptive icon with its launcher colour, and core/app/rules/app-icons-spec.js, the page's mirror of this file. pnpm run build fails when a generated copy is stale.",
  "default": "naranja_dark",
  "followTheme": {
    "id": "theme",
    "label": "Follow theme"
  },
  "families": [
    {
      "id": "naranja",
      "label": "Barro",
      "variants": {
        "light": {
          "id": "naranja_light",
          "label": "Light",
          "scheme": "light",
          "colors": {
            "accent": "#efe7d8",
            "accent-fg": "#8a3324",
            "fg": "#2b241c",
            "bg": "#fbf8f2",
            "bg-raised": "#ffffff",
            "danger": "#b91c1c",
            "badge": "#dc2626",
            "badge-fg": "#ffffff"
          }
        },
        "dark": {
          "id": "naranja_dark",
          "label": "Dark",
          "scheme": "light",
          "colors": {
            "accent": "#bd4531",
            "accent-fg": "#ffffff",
            "fg": "#211e1a",
            "bg": "#faf9f7",
            "bg-raised": "#ffffff",
            "danger": "#b91c1c",
            "badge": "#dc2626",
            "badge-fg": "#ffffff"
          }
        }
      }
    },
    {
      "id": "azul",
      "label": "Azul",
      "variants": {
        "light": {
          "id": "azul_light",
          "label": "Light",
          "scheme": "light",
          "colors": {
            "accent": "#dbeafe",
            "accent-fg": "#1e3a8a",
            "fg": "#0b2545",
            "bg": "#f5f9ff",
            "bg-raised": "#ffffff",
            "danger": "#b91c1c",
            "badge": "#dc2626",
            "badge-fg": "#ffffff"
          }
        },
        "dark": {
          "id": "azul_dark",
          "label": "Dark",
          "scheme": "light",
          "colors": {
            "accent": "#0a84ff",
            "accent-fg": "#ffffff",
            "fg": "#0b2545",
            "bg": "#f5f9ff",
            "bg-raised": "#ffffff",
            "danger": "#b91c1c",
            "badge": "#dc2626",
            "badge-fg": "#ffffff"
          }
        }
      }
    },
    {
      "id": "rosa",
      "label": "Rosa",
      "variants": {
        "light": {
          "id": "rosa_light",
          "label": "Light",
          "scheme": "light",
          "colors": {
            "accent": "#fce7f3",
            "accent-fg": "#9d174d",
            "fg": "#3a0b28",
            "bg": "#fdf4f9",
            "bg-raised": "#ffffff",
            "danger": "#b91c1c",
            "badge": "#dc2626",
            "badge-fg": "#ffffff"
          }
        },
        "dark": {
          "id": "rosa_dark",
          "label": "Dark",
          "scheme": "light",
          "colors": {
            "accent": "#e4007c",
            "accent-fg": "#ffffff",
            "fg": "#3a0b28",
            "bg": "#fdf4f9",
            "bg-raised": "#ffffff",
            "danger": "#b91c1c",
            "badge": "#dc2626",
            "badge-fg": "#ffffff"
          }
        }
      }
    },
    {
      "id": "jade",
      "label": "Nopal",
      "variants": {
        "light": {
          "id": "jade_light",
          "label": "Light",
          "scheme": "light",
          "colors": {
            "accent": "#d1fae5",
            "accent-fg": "#065f46",
            "fg": "#062b1f",
            "bg": "#f3fbf8",
            "bg-raised": "#ffffff",
            "danger": "#b91c1c",
            "badge": "#dc2626",
            "badge-fg": "#ffffff"
          }
        },
        "dark": {
          "id": "jade_dark",
          "label": "Dark",
          "scheme": "light",
          "colors": {
            "accent": "#00a36c",
            "accent-fg": "#ffffff",
            "fg": "#062b1f",
            "bg": "#f3fbf8",
            "bg-raised": "#ffffff",
            "danger": "#b91c1c",
            "badge": "#dc2626",
            "badge-fg": "#ffffff"
          }
        }
      }
    },
    {
      "id": "morado",
      "label": "Morado",
      "variants": {
        "light": {
          "id": "morado_light",
          "label": "Light",
          "scheme": "light",
          "colors": {
            "accent": "#ede9fe",
            "accent-fg": "#5b21b6",
            "fg": "#22103f",
            "bg": "#faf7ff",
            "bg-raised": "#ffffff",
            "danger": "#b91c1c",
            "badge": "#dc2626",
            "badge-fg": "#ffffff"
          }
        },
        "dark": {
          "id": "morado_dark",
          "label": "Dark",
          "scheme": "light",
          "colors": {
            "accent": "#7c3aed",
            "accent-fg": "#ffffff",
            "fg": "#22103f",
            "bg": "#faf7ff",
            "bg-raised": "#ffffff",
            "danger": "#b91c1c",
            "badge": "#dc2626",
            "badge-fg": "#ffffff"
          }
        }
      }
    }
  ]
};

// The Flor de muerto masters (core/spec/icon), read by rules/icon.js parseGlyph.
export const ICON_MASTERS = {
  full: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><defs><mask id=\"g0f\" maskUnits=\"userSpaceOnUse\" x=\"-10\" y=\"-10\" width=\"120\" height=\"120\"><rect x=\"-10\" y=\"-10\" width=\"120\" height=\"120\" fill=\"white\"/><g fill=\"black\"><path transform=\"translate(32 54) rotate(0)\" d=\"M0,-1.48 Q3.10,-4.44 0,-7.4 Q-3.10,-4.44 0,-1.48Z\"/><path transform=\"translate(32 54) rotate(60)\" d=\"M0,-1.48 Q3.10,-4.44 0,-7.4 Q-3.10,-4.44 0,-1.48Z\"/><path transform=\"translate(32 54) rotate(120)\" d=\"M0,-1.48 Q3.10,-4.44 0,-7.4 Q-3.10,-4.44 0,-1.48Z\"/><path transform=\"translate(32 54) rotate(180)\" d=\"M0,-1.48 Q3.10,-4.44 0,-7.4 Q-3.10,-4.44 0,-1.48Z\"/><path transform=\"translate(32 54) rotate(240)\" d=\"M0,-1.48 Q3.10,-4.44 0,-7.4 Q-3.10,-4.44 0,-1.48Z\"/><path transform=\"translate(32 54) rotate(300)\" d=\"M0,-1.48 Q3.10,-4.44 0,-7.4 Q-3.10,-4.44 0,-1.48Z\"/><circle cx=\"32\" cy=\"54\" r=\"2.22\"/><circle cx=\"32\" cy=\"54\" r=\"1.18\" fill=\"white\"/><path transform=\"translate(50 54) rotate(0)\" d=\"M0,-1.48 Q3.10,-4.44 0,-7.4 Q-3.10,-4.44 0,-1.48Z\"/><path transform=\"translate(50 54) rotate(60)\" d=\"M0,-1.48 Q3.10,-4.44 0,-7.4 Q-3.10,-4.44 0,-1.48Z\"/><path transform=\"translate(50 54) rotate(120)\" d=\"M0,-1.48 Q3.10,-4.44 0,-7.4 Q-3.10,-4.44 0,-1.48Z\"/><path transform=\"translate(50 54) rotate(180)\" d=\"M0,-1.48 Q3.10,-4.44 0,-7.4 Q-3.10,-4.44 0,-1.48Z\"/><path transform=\"translate(50 54) rotate(240)\" d=\"M0,-1.48 Q3.10,-4.44 0,-7.4 Q-3.10,-4.44 0,-1.48Z\"/><path transform=\"translate(50 54) rotate(300)\" d=\"M0,-1.48 Q3.10,-4.44 0,-7.4 Q-3.10,-4.44 0,-1.48Z\"/><circle cx=\"50\" cy=\"54\" r=\"2.22\"/><circle cx=\"50\" cy=\"54\" r=\"1.18\" fill=\"white\"/><path transform=\"translate(41 64.5) scale(1)\" d=\"M0,-3.6 C2.5,-1.1 4.5,0.9 3,2.9 C2,4.2 0.6,3.7 0,2.7 C-0.6,3.7 -2,4.2 -3,2.9 C-4.5,0.9 -2.5,-1.1 0,-3.6Z\"/><rect x=\"31\" y=\"71\" width=\"20\" height=\"3.4\" rx=\"1.7\"/><rect x=\"34.4\" y=\"70\" width=\"1.2\" height=\"5.4\" fill=\"white\"/><rect x=\"38.4\" y=\"70\" width=\"1.2\" height=\"5.4\" fill=\"white\"/><rect x=\"42.4\" y=\"70\" width=\"1.2\" height=\"5.4\" fill=\"white\"/><rect x=\"46.4\" y=\"70\" width=\"1.2\" height=\"5.4\" fill=\"white\"/><circle cx=\"27\" cy=\"63\" r=\"1.4\"/><circle cx=\"55\" cy=\"63\" r=\"1.4\"/></g></mask><mask id=\"g0b\" maskUnits=\"userSpaceOnUse\" x=\"-10\" y=\"-10\" width=\"120\" height=\"120\"><rect x=\"-10\" y=\"-10\" width=\"120\" height=\"120\" fill=\"white\"/><g fill=\"black\" stroke=\"black\" stroke-width=\"10\" stroke-linejoin=\"round\"><circle cx=\"41\" cy=\"58\" r=\"26\"/><path d=\"M24,76 L13,90 L37,82Z\"/></g><g fill=\"black\"><path transform=\"translate(62 29.5) rotate(0)\" d=\"M0,-1.04 Q2.18,-3.12 0,-5.2 Q-2.18,-3.12 0,-1.04Z\"/><path transform=\"translate(62 29.5) rotate(60)\" d=\"M0,-1.04 Q2.18,-3.12 0,-5.2 Q-2.18,-3.12 0,-1.04Z\"/><path transform=\"translate(62 29.5) rotate(120)\" d=\"M0,-1.04 Q2.18,-3.12 0,-5.2 Q-2.18,-3.12 0,-1.04Z\"/><path transform=\"translate(62 29.5) rotate(180)\" d=\"M0,-1.04 Q2.18,-3.12 0,-5.2 Q-2.18,-3.12 0,-1.04Z\"/><path transform=\"translate(62 29.5) rotate(240)\" d=\"M0,-1.04 Q2.18,-3.12 0,-5.2 Q-2.18,-3.12 0,-1.04Z\"/><path transform=\"translate(62 29.5) rotate(300)\" d=\"M0,-1.04 Q2.18,-3.12 0,-5.2 Q-2.18,-3.12 0,-1.04Z\"/><circle cx=\"62\" cy=\"29.5\" r=\"1.56\"/><circle cx=\"62\" cy=\"29.5\" r=\"0.83\" fill=\"white\"/><path transform=\"translate(75 32.5) rotate(0)\" d=\"M0,-1.04 Q2.18,-3.12 0,-5.2 Q-2.18,-3.12 0,-1.04Z\"/><path transform=\"translate(75 32.5) rotate(60)\" d=\"M0,-1.04 Q2.18,-3.12 0,-5.2 Q-2.18,-3.12 0,-1.04Z\"/><path transform=\"translate(75 32.5) rotate(120)\" d=\"M0,-1.04 Q2.18,-3.12 0,-5.2 Q-2.18,-3.12 0,-1.04Z\"/><path transform=\"translate(75 32.5) rotate(180)\" d=\"M0,-1.04 Q2.18,-3.12 0,-5.2 Q-2.18,-3.12 0,-1.04Z\"/><path transform=\"translate(75 32.5) rotate(240)\" d=\"M0,-1.04 Q2.18,-3.12 0,-5.2 Q-2.18,-3.12 0,-1.04Z\"/><path transform=\"translate(75 32.5) rotate(300)\" d=\"M0,-1.04 Q2.18,-3.12 0,-5.2 Q-2.18,-3.12 0,-1.04Z\"/><circle cx=\"75\" cy=\"32.5\" r=\"1.56\"/><circle cx=\"75\" cy=\"32.5\" r=\"0.83\" fill=\"white\"/><path transform=\"translate(70.5 41) scale(0.7)\" d=\"M0,-3.6 C2.5,-1.1 4.5,0.9 3,2.9 C2,4.2 0.6,3.7 0,2.7 C-0.6,3.7 -2,4.2 -3,2.9 C-4.5,0.9 -2.5,-1.1 0,-3.6Z\"/></g></mask></defs><g mask=\"url(#g0b)\" fill=\"#000\" fill-opacity=\"1\"><circle cx=\"62\" cy=\"38\" r=\"23\"/><path d=\"M76,54 L88,68 L66,59Z\"/></g><g mask=\"url(#g0f)\" fill=\"#000\"><circle cx=\"41\" cy=\"58\" r=\"26\"/><path d=\"M24,76 L13,90 L37,82Z\"/></g></svg>\n",
  small: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"11 13 79 79\"><defs><mask id=\"g1f\" maskUnits=\"userSpaceOnUse\" x=\"-10\" y=\"-10\" width=\"120\" height=\"120\"><rect x=\"-10\" y=\"-10\" width=\"120\" height=\"120\" fill=\"white\"/><g fill=\"black\"><circle cx=\"32\" cy=\"55\" r=\"7.2\"/><circle cx=\"50\" cy=\"55\" r=\"7.2\"/><path transform=\"translate(41 66) scale(1.25)\" d=\"M0,-3.6 C2.5,-1.1 4.5,0.9 3,2.9 C2,4.2 0.6,3.7 0,2.7 C-0.6,3.7 -2,4.2 -3,2.9 C-4.5,0.9 -2.5,-1.1 0,-3.6Z\"/></g></mask><mask id=\"g1b\" maskUnits=\"userSpaceOnUse\" x=\"-10\" y=\"-10\" width=\"120\" height=\"120\"><rect x=\"-10\" y=\"-10\" width=\"120\" height=\"120\" fill=\"white\"/><g fill=\"black\" stroke=\"black\" stroke-width=\"10\" stroke-linejoin=\"round\"><circle cx=\"41\" cy=\"58\" r=\"26\"/><path d=\"M24,76 L13,90 L37,82Z\"/></g><g fill=\"black\"><circle cx=\"62\" cy=\"30\" r=\"4.6\"/><circle cx=\"75\" cy=\"33\" r=\"4.6\"/></g></mask></defs><g mask=\"url(#g1b)\" fill=\"#000\" fill-opacity=\"1\"><circle cx=\"62\" cy=\"38\" r=\"23\"/><path d=\"M76,54 L88,68 L66,59Z\"/></g><g mask=\"url(#g1f)\" fill=\"#000\"><circle cx=\"41\" cy=\"58\" r=\"26\"/><path d=\"M24,76 L13,90 L37,82Z\"/></g></svg>\n",
};
