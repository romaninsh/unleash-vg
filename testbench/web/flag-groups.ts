/**
 * Which group (app section) each known flag belongs to, with the label and icon the mock bank app
 * uses. This is the single source for grouping in the bench, and the same groups are in the demo
 * data (docs/spec/reference-data). The SDK API carries no tags, so the
 * bench cannot read a group from a backend. Unknown flags fall into "Other".
 *
 * Group "App" flags change the app as a whole (theme, banners, chat) and are drawn specially.
 */

export const GROUP_ORDER = [
  'App',
  'Sign in',
  'Onboarding',
  'Accounts',
  'Cards',
  'Payments',
  'Savings',
  'Insights',
  'Products',
  'Documents',
  'Notifications',
  'Other',
] as const;

export type Group = (typeof GROUP_ORDER)[number];

export const FLAG_GROUPS: Record<string, { group: Group; label: string; icon: string }> = {
  'dark-mode': { group: 'App', label: 'Dark mode', icon: '🌙' },
  'new-dashboard-layout': { group: 'App', label: 'New dashboard layout', icon: '🆕' },
  'maintenance-banner': { group: 'App', label: 'Maintenance banner', icon: '🛠️' },
  'chat-support': { group: 'App', label: 'Chat with us', icon: '💬' },
  'sso-login': { group: 'Sign in', label: 'Sign in with company SSO', icon: '🔐' },
  'biometric-login': { group: 'Sign in', label: 'Use Face ID / fingerprint', icon: '🫆' },
  'old-login-page': { group: 'Sign in', label: 'Classic login page', icon: '🗝️' },
  'new-onboarding': { group: 'Onboarding', label: 'New onboarding flow', icon: '👋' },
  'new-onboarding-flow': { group: 'Onboarding', label: 'New onboarding flow', icon: '👋' },
  'kyc-video-verification': { group: 'Onboarding', label: 'Verify identity by video', icon: '🎥' },
  'multi-currency-accounts': { group: 'Accounts', label: 'Multi-currency accounts', icon: '💱' },
  'open-banking-consent': { group: 'Accounts', label: 'Connect other banks', icon: '🔗' },
  'open-banking-aggregation': { group: 'Accounts', label: 'Connect other banks', icon: '🔗' },
  'debit-card-payments': { group: 'Cards', label: 'Pay with debit card', icon: '💳' },
  'virtual-cards': { group: 'Cards', label: 'Virtual cards', icon: '🪪' },
  'card-freeze': { group: 'Cards', label: 'Freeze card', icon: '🧊' },
  'apple-pay': { group: 'Cards', label: 'Add to Apple Pay', icon: '' },
  'google-pay': { group: 'Cards', label: 'Add to Google Pay', icon: 'G' },
  'instant-transfers': { group: 'Payments', label: 'Instant transfer', icon: '⚡' },
  'payee-confirmation': { group: 'Payments', label: 'Confirmation of payee', icon: '✅' },
  'legacy-transfer-screen': { group: 'Payments', label: 'Legacy transfer screen', icon: '📜' },
  'direct-debit-manager': { group: 'Payments', label: 'Direct debits', icon: '🔁' },
  'savings-goals': { group: 'Savings', label: 'Savings goals', icon: '🎯' },
  'savings-pots': { group: 'Savings', label: 'Savings pots', icon: '🍯' },
  'round-up-savings': { group: 'Savings', label: 'Round-up savings', icon: '🪙' },
  'spending-insights': { group: 'Insights', label: 'Spending insights', icon: '📊' },
  'transaction-categorisation': { group: 'Insights', label: 'Categorised transactions', icon: '🏷️' },
  'beta-budget-planner': { group: 'Insights', label: 'Budget planner (beta)', icon: '🧮' },
  'loan-calculator': { group: 'Products', label: 'Loan calculator', icon: '🏦' },
  'referral-program': { group: 'Products', label: 'Refer a friend', icon: '🎁' },
  'crypto-wallet': { group: 'Products', label: 'Crypto wallet', icon: '₿' },
  'beta-crypto-wallet': { group: 'Products', label: 'Crypto wallet (beta)', icon: '₿' },
  'legacy-statements-pdf': { group: 'Documents', label: 'PDF statements (legacy)', icon: '📄' },
  'statement-pdf-v2': { group: 'Documents', label: 'PDF statements v2', icon: '📄' },
  'export-csv': { group: 'Documents', label: 'Export CSV', icon: '⬇️' },
  'push-notifications-v2': { group: 'Notifications', label: 'Push notifications v2', icon: '🔔' },
  'overdraft-alerts': { group: 'Notifications', label: 'Overdraft alerts', icon: '⚠️' },
};

export function groupOf(flag: string): Group {
  return FLAG_GROUPS[flag]?.group ?? 'Other';
}
