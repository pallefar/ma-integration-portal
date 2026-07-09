const fs = require('fs');
const path = require('path');

const dashHtml = path.join(__dirname, 'public/dashboard.html');
const dashJs = path.join(__dirname, 'public/js/dashboard.js');

// 1. Remove reorder controls from HTML
let htmlContent = fs.readFileSync(dashHtml, 'utf8');
htmlContent = htmlContent.replace(/<div class="reorder-controls-overlay">[\s\S]*?<\/div>/g, '');
htmlContent = htmlContent.replace(/ edit-active-border/g, '');
fs.writeFileSync(dashHtml, htmlContent, 'utf8');

// 2. Remove reorder logic from JS
let jsContent = fs.readFileSync(dashJs, 'utf8');
// We don't necessarily have to remove sortDOMWidgets, but we should remove the click listeners for .reorder-btn
jsContent = jsContent.replace(/document\.querySelectorAll\('\.reorder-btn'\)\.forEach\([^]*?\}\);/g, '');
jsContent = jsContent.replace(/function reorderWidget[^]*?saveLayoutOrder\(currentLayoutOrder, widgetId\);\n    \}\n  \}/g, '');
fs.writeFileSync(dashJs, jsContent, 'utf8');

console.log('Layout edit controls removed.');
