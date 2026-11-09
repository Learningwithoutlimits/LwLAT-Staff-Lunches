// First-time tour of the home page. Steps for things a person can't use are skipped.
import type { TourStep } from '../lib/tour.ts';

export const homeTour = (firstName: string, admin: boolean, manage: boolean, toManage: () => void, toDash: () => void): TourStep[] => [
  { title: `Welcome${firstName ? `, ${firstName}` : ''}`, body: '<p>This shows which staff get a free lunch, and on which days from Monday to Friday. It only takes a minute to look round.</p>', before: toDash },
  { target: '#stats', title: 'At a glance', body: '<p>Free lunches today, how many staff have them, and the total for the week, across the sites you can see.</p>', before: toDash },
  { target: '#siteCards', title: 'Each school', body: '<p>One card per site, with today\'s number and a bar for each weekday. Select a card to show just that site.</p>', before: toDash },
  { target: '#dayFilter', title: 'Pick a day', body: '<p>Show who has a free lunch on one day, everyone with a free lunch, or the whole staff list.</p>', before: toDash },
  { target: '#printDay', title: 'Print for the kitchen', body: '<p>Print the list for the chosen day, one page per site, with a column to tick off as lunches are served.</p>', before: toDash },
  { target: '#exportCsv', title: 'Export', body: '<p>Download the list as a spreadsheet that opens in Excel.</p>', before: toDash },
  ...(manage ? [
    { target: '#tabManage', title: 'Manage staff', body: '<p>For admins of a site: choose who gets a free lunch and on which days.</p>', before: toManage },
    { target: '#importBtn', title: 'Import the staff list', body: '<p>Load the full staff list from a CSV file. New people start with no free lunches, and people already on the list keep theirs.</p>', before: toManage },
    { target: '#mRows', title: 'Choose the days', body: '<p>Select a day to switch a free lunch on or off. <b>All week</b> does Monday to Friday in one go. Every change is saved straight away and logged.</p>', before: toManage },
  ] : []),
  ...(admin ? [{ target: '#adminLink', title: 'Access', body: '<p>Choose who can use the app and who can manage each site\'s free lunches, and see the change log.</p>', before: toDash }] : []),
  { target: '[data-pulse]', title: 'Back to Pulse', body: '<p>Return to LwLAT Pulse at any time.</p>' },
  { target: '[data-settings]', title: 'Settings', body: '<p>Light or dark mode, colour theme, text size and other accessibility options, and this tour again under <b>Help</b>.</p>' },
];
