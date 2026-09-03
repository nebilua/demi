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
    text: '#F5F2EA',
    tint: '#E8A95B',

    // Core surfaces
    background: '#111315',
    foreground: '#F5F2EA',

    // Cards / elevated surfaces
    card: '#191D1E',
    cardForeground: '#F5F2EA',

    // Primary action color (buttons, links, active states)
    primary: '#E8A95B',
    primaryForeground: '#171410',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#232829',
    secondaryForeground: '#EDEAE1',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#232829',
    mutedForeground: '#8D9694',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#203A36',
    accentForeground: '#B7D8C8',

    // Destructive actions (delete, error states)
    destructive: '#C96A5B',
    destructiveForeground: '#FFF7F4',

    // Borders and input outlines
    border: '#2B3333',
    input: '#2B3333',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 18,
};

export default colors;
