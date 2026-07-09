const fs = require('fs');
const path = require('path');

const filesToUpdate = [
  'aiService.js',
  'server.js',
  'public/admin.html',
  'public/css/style.css',
  'public/js/transitions.js',
  'public/js/admin.js',
  'public/js/dashboard.js',
  'public/dashboard.html'
];

filesToUpdate.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Replace Variations
    content = content.replace(/SmolAgent/g, 'AI Insight');
    content = content.replace(/smolagent/g, 'ai-insight');
    content = content.replace(/smolAgent/g, 'aiInsight');
    content = content.replace(/small agents/gi, 'AI insight');
    content = content.replace(/small agent/gi, 'AI insight');
    
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated ${file}`);
  }
});
