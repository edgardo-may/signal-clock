const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'features', 'users', 'pages', 'UsersPage.jsx');
let content = fs.readFileSync(file, 'utf8');

const replacements = [
  // Modals backgrounds
  { from: /bg-\[#11192e\]/g, to: 'bg-white dark:bg-slate-900' },
  // Modal Overlays
  { from: /bg-slate-950\/80/g, to: 'bg-slate-900/40 dark:bg-slate-950/80' },
  // Headers in Modals
  { from: /text-white/g, to: 'text-slate-900 dark:text-white' },
  // Input backgrounds
  { from: /bg-slate-950/g, to: 'bg-slate-50 dark:bg-slate-950' },
  // General text muted
  { from: /text-slate-300/g, to: 'text-slate-700 dark:text-slate-300' },
  { from: /text-slate-400/g, to: 'text-slate-500 dark:text-slate-400' },
  // Modal specific text
  { from: /text-white/g, to: 'text-slate-900 dark:text-white' }, // Repeated safely
  // Borders
  { from: /border-slate-800/g, to: 'border-slate-200 dark:border-slate-800' },
  { from: /border-slate-700/g, to: 'border-slate-300 dark:border-slate-700' },
  // Specific Buttons
  { from: /bg-slate-800/g, to: 'bg-slate-100 dark:bg-slate-800' },
  { from: /hover:bg-slate-800/g, to: 'hover:bg-slate-200 dark:hover:bg-slate-800' },
  { from: /hover:text-white/g, to: 'hover:text-slate-900 dark:hover:text-white' }
];

replacements.forEach(({ from, to }) => {
  content = content.replace(from, to);
});

// Fix any double texts
content = content.replace(/text-slate-900 dark:text-slate-900 dark:text-white/g, 'text-slate-900 dark:text-white');
content = content.replace(/text-slate-500 dark:text-slate-500 dark:text-slate-400/g, 'text-slate-500 dark:text-slate-400');
content = content.replace(/text-slate-700 dark:text-slate-700 dark:text-slate-300/g, 'text-slate-700 dark:text-slate-300');
content = content.replace(/border-slate-200 dark:border-slate-200 dark:border-slate-800/g, 'border-slate-200 dark:border-slate-800');

fs.writeFileSync(file, content, 'utf8');
console.log('Theme classes updated successfully.');
