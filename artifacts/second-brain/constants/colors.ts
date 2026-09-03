/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#1E2424',
    tint: '#A8642B',

    // Core surfaces
    background: '#F4F0E8',
    foreground: '#1E2424',

    // Cards / elevated surfaces
    card: '#FFFCF5',
    cardForeground: '#1E2424',

    // Primary action color (buttons, links, active states)
    primary: '#A8642B',
    primaryForeground: '#FFF9F0',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#E8E1D5',
    secondaryForeground: '#303737',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#E8E1D5',
    mutedForeground: '#697270',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#DCEBE2',
    accentForeground: '#2E5B4C',

    // Destructive actions (delete, error states)
    destructive: '#B54D3F',
    destructiveForeground: '#FFF7F4',

    // Borders and input outlines
    border: '#DDD5C8',
    input: '#DDD5C8',
  },
  dark: {
    text: '#F5F2EA',
    tint: '#E8A95B',
    background: '#111315',
    foreground: '#F5F2EA',
    card: '#191D1E',
    cardForeground: '#F5F2EA',
    primary: '#E8A95B',
    primaryForeground: '#171410',
    secondary: '#232829',
    secondaryForeground: '#EDEAE1',
    muted: '#232829',
    mutedForeground: '#8D9694',
    accent: '#203A36',
    accentForeground: '#B7D8C8',
    destructive: '#C96A5B',
    destructiveForeground: '#FFF7F4',
    border: '#2B3333',
    input: '#2B3333',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 18,
};

export default colors;
