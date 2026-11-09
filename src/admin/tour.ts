// First-time tour of the admin portal. Steps for things a person can't see (e.g. a site admin and the Sites tab) are skipped.
import type { TourStep } from '../lib/tour.ts';

export const adminTour = (firstName: string, full: boolean, showTab: (t: string) => void): TourStep[] => [
  { title: `Welcome to the admin portal${firstName ? `, ${firstName}` : ''}`, before: () => showTab('people'),
    body: full ? '<p>Who can use the app, the sites and access rules, sign-ins, the change log and the security review.</p>'
               : "<p>You're a <b>site admin</b>: you can manage Site access for your sites.</p>" },
  { target: '.tabs', title: 'Sections', body: '<p>A number on <b>Sign-ins</b> means someone was turned away and is waiting for access.</p>' },
  { target: '#openAdd', title: 'Give someone access', body: '<p>Add a person by email and choose their <b>role</b> and <b>sites</b>. Changes are saved with the bar at the bottom.</p>' },
  { target: '#accessHelp', title: 'How access works', body: '<p>Open this for the order rules are checked in, and what each role can do.</p>' },
  { target: '#openViewAs', title: 'View as', body: "<p>See the app exactly as someone else would, read-only. Useful for checking access.</p>" },
  { target: '[data-tab="security"]', title: 'Security review', body: "<p>The app's security controls with their evidence, plus live health, backup and credential expiry status.</p>" },
  { target: '[data-settings]', title: 'Settings', body: '<p>Appearance and accessibility, and this tour again under <b>Help</b>.</p>' },
];
