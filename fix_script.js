const fs = require('fs');
const path = require('path');

const filesToUpdate = [
  'public/js/transitions.js',
  'public/js/admin.js',
  'public/js/dashboard.js',
  'aiService.js',
  'server.js',
  'public/admin.html',
  'public/dashboard.html'
];

filesToUpdate.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Fix broken JS identifiers
    content = content.replace(/AI InsightModal/g, 'AiInsightModal');
    content = content.replace(/GlobalAI Insight/g, 'GlobalAiInsight');
    content = content.replace(/initializeAI Insight/g, 'initializeAiInsight');
    content = content.replace(/AI Insight model/g, 'AI Insight model'); // valid
    content = content.replace(/function checkAndShowAiInsightModal/g, 'function checkAndShowAiInsightModal'); // just in case
    
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Fixed syntax in ${file}`);
  }
});
