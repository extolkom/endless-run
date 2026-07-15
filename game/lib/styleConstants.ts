// Shared style constants for ninja-themed dashboard aesthetic
// This file provides reusable design tokens and presets for Phases 2+
// Currently additive only — not yet wired into any visible UI

// Spacing scale (in pixels — can be easily converted to rem if needed)
export const SPACING = {
  xs: '4px',
  sm: '8px',
  md: '16px',
  lg: '24px',
  xl: '32px',
  xxl: '48px',
} as const;

// Border radius values for different component types
export const BORDER_RADIUS = {
  button: '6px',      // subtle roundness for buttons
  card: '12px',       // moderate roundness for cards/panels
  container: '16px',  // larger radius for main containers
  circle: '50%',      // for avatar-style elements
} as const;

// Box-shadow presets using NINJA_THEME colors
export const SHADOWS = {
  // Soft/subtle glows for card backgrounds
  glowSoftBlue: '0 0 16px rgba(57, 195, 255, 0.15)',      // --ninja-accent-primary soft
  glowSoftCyan: '0 0 12px rgba(96, 168, 255, 0.1)',       // --ninja-accent-secondary soft

  // Medium glows for active/hover states
  glowMediumBlue: '0 0 24px rgba(57, 195, 255, 0.3)',
  glowMediumSuccess: '0 0 20px rgba(80, 216, 146, 0.2)',

  // Strong glows for emphasized/selected states
  glowStrongBlue: '0 0 32px rgba(57, 195, 255, 0.4)',
  glowStrongError: '0 0 28px rgba(255, 90, 109, 0.35)',

  // Elevation shadow (traditional drop-shadow for depth)
  elevation: '0 8px 32px rgba(0, 0, 0, 0.5)',
} as const;

// Gradient presets using the ninja palette
export const GRADIENTS = {
  // Blue gradient accents (primary to secondary blue)
  accentBlue: 'linear-gradient(135deg, #39c3ff, #60a8ff)',

  // Reverse gradient (secondary to primary)
  accentBlueReverse: 'linear-gradient(135deg, #60a8ff, #39c3ff)',

  // Success gradient for positive states
  successGradient: 'linear-gradient(135deg, #50d892, #3aa86d)',

  // Error gradient for failure states
  errorGradient: 'linear-gradient(135deg, #ff5a6d, #cc3d52)',

  // Subtle background gradient (using ninja backgrounds)
  bgSubtle: 'linear-gradient(135deg, #040a1a, #0b1732)',
} as const;

// Card/panel style presets (combining shadow + radius + padding)
export const CARD_STYLES = {
  elevated: {
    borderRadius: BORDER_RADIUS.card,
    boxShadow: SHADOWS.glowSoftBlue,
    padding: SPACING.lg,
    background: 'rgba(11, 23, 50, 0.8)',  // slightly transparent ninja-bg-secondary
    backdropFilter: 'blur(8px)',           // frosted glass effect
  },

  elevated_interactive: {
    borderRadius: BORDER_RADIUS.card,
    boxShadow: SHADOWS.glowMediumBlue,
    padding: SPACING.lg,
    background: 'rgba(11, 23, 50, 0.9)',
    backdropFilter: 'blur(8px)',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
} as const;
