/**
 * TE Connectivity M&A Integration Portal - ragService
 * A lightweight, dependency-free local RAG (Retrieval-Augmented Generation) system.
 * Indexes playbooks from public/playbook.html and retrieves contextual snippets 
 * to guide AI plan generations and set strict compliance guardrails.
 */

const fs = require('fs');
const path = require('path');

// Common English stop words to filter out during tokenization
const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'arent', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'cant', 'cannot', 'could', 'couldnt',
  'did', 'didnt', 'do', 'does', 'doesnt', 'doing', 'dont', 'down', 'during',
  'each',
  'few', 'for', 'from', 'further',
  'had', 'hadnt', 'has', 'hasnt', 'have', 'havent', 'having', 'he', 'hed', 'hell', 'hes', 'her', 'here', 'heres', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'hows',
  'i', 'id', 'ill', 'im', 'ive', 'if', 'in', 'into', 'is', 'isnt', 'it', 'its', 'itself',
  'lets',
  'me', 'more', 'most', 'mustnt', 'my', 'myself',
  'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
  'same', 'shant', 'she', 'shed', 'shell', 'shes', 'should', 'shouldnt', 'so', 'some', 'such',
  'than', 'that', 'thats', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'theres', 'these', 'they', 'theyd', 'theyll', 'theyre', 'theyve', 'this', 'those', 'through', 'to', 'too',
  'under', 'until', 'up', 'very',
  'was', 'wasnt', 'we', 'wed', 'well', 'were', 'weve', 'werent', 'what', 'whats', 'when', 'whens', 'where', 'wheres', 'which', 'while', 'who', 'whos', 'whom', 'why', 'whys', 'with', 'wont', 'would', 'wouldnt',
  'you', 'youd', 'youll', 'youre', 'youve', 'your', 'yours', 'yourself', 'yourselves'
]);

// Memory-resident corpus of documents/chunks
let documentCorpus = [];
let tfIdfModel = {
  chunks: [],
  idf: {}
};

/**
 * Clean HTML tags from a string
 */
function cleanHtml(html) {
  return html
    .replace(/<[^>]*>/g, ' ') // Strip tags
    .replace(/\s+/g, ' ')     // Unify whitespace
    .trim();
}

/**
 * Tokenize a text string, lowercasing and filtering stop words
 */
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // remove punctuation
    .split(/[\s-]+/)
    .filter(token => token.length > 1 && !STOP_WORDS.has(token));
}

/**
 * Initialize the RAG indexer by parsing public/playbook.html
 */
function initializeRAG() {
  try {
    const playbookPath = path.join(__dirname, 'public', 'playbook.html');
    if (!fs.existsSync(playbookPath)) {
      console.warn(`RAG Warning: Playbook file not found at ${playbookPath}. RAG initialized empty.`);
      return false;
    }

    const htmlContent = fs.readFileSync(playbookPath, 'utf8');
    
    // Standard chapters to parse based on divs
    // We will extract sections like <div id="culture" ...> up to the next section or footer
    const sectionRegex = /<div\s+id="([^"]+)"\s+class="playbook-section">([\s\S]*?)<\/div>/g;
    let match;
    const rawSections = [];

    while ((match = sectionRegex.exec(htmlContent)) !== null) {
      rawSections.push({
        id: match[1],
        html: match[2]
      });
    }

    const chunks = [];
    let chunkIdCounter = 0;

    rawSections.forEach(section => {
      const chapterName = getChapterDisplayName(section.id);
      
      // Split the section HTML into paragraphs, lists, and alert boxes to extract high-quality text chunks
      // We will parse:
      // 1. Alert Boxes
      // 2. Paragraphs <p>
      // 3. Lists <ul> / <li>
      
      const subHtml = section.html;
      
      // Parse Alert Boxes
      const alertRegex = /<div\s+class="alert-box\s+([^"]+)">([\s\S]*?)<\/div>/g;
      let alertMatch;
      while ((alertMatch = alertRegex.exec(subHtml)) !== null) {
        const alertHtml = alertMatch[2];
        const titleMatch = alertHtml.match(/<span\s+class="alert-title">([\s\S]*?)<\/span>/);
        const contentMatch = alertHtml.match(/<span\s+class="alert-content">([\s\S]*?)<\/span>/);
        
        if (contentMatch) {
          const title = titleMatch ? cleanHtml(titleMatch[1]) : "Compliance Guardrail";
          const text = cleanHtml(contentMatch[1]);
          chunks.push({
            id: `chunk_${chunkIdCounter++}`,
            chapter: chapterName,
            category: "Alert/Guardrail",
            title: title,
            text: `${title}: ${text}`
          });
        }
      }

      // Parse Paragraphs
      const pRegex = /<p>([\s\S]*?)<\/p>/g;
      let pMatch;
      while ((pMatch = pRegex.exec(subHtml)) !== null) {
        const text = cleanHtml(pMatch[1]);
        if (text.length > 40 && !text.includes("Welcome to the official")) {
          // If it contains a bold header like "**Days 1-15:**" or similar
          const boldMatch = text.match(/^\*\*([^*]+)\*\*:\s*(.*)/);
          const title = boldMatch ? boldMatch[1] : "General Standard";
          
          chunks.push({
            id: `chunk_${chunkIdCounter++}`,
            chapter: chapterName,
            category: "Guideline Paragraph",
            title: title,
            text: text
          });
        }
      }

      // Parse Unordered Lists
      const ulRegex = /<ul>([\s\S]*?)<\/ul>/g;
      let ulMatch;
      while ((ulMatch = ulRegex.exec(subHtml)) !== null) {
        const liRegex = /<li>([\s\S]*?)<\/li>/g;
        let liMatch;
        const listItems = [];
        while ((liMatch = liRegex.exec(ulMatch[1])) !== null) {
          listItems.push(cleanHtml(liMatch[1]));
        }
        if (listItems.length > 0) {
          chunks.push({
            id: `chunk_${chunkIdCounter++}`,
            chapter: chapterName,
            category: "List Details",
            title: "Operational Framework Checklist",
            text: `Framework parameters under ${chapterName}:\n` + listItems.map(item => `- ${item}`).join('\n')
          });
        }
      }
    });

    // Seed additional explicit corporate M&A regulatory and integration safety compliance rules
    // to act as ultimate guardrails in case they aren't fully detailed in the playbook HTML.
    const strictGuardrails = [
      {
        id: `chunk_gr_0`,
        chapter: "M&A Regulatory & Legal Compliance",
        category: "Strict Regulatory Guardrail",
        title: "IP and Patent Protection",
        text: "IP and Patent Protection Compliance: Under strict TE Connectivity Legal Policy, no acquired patents, schematics, or physical connector drafts are to be shared or uploaded to non-TE secure servers. All engineering designs must remain indexed under SSO-restricted internal storage solutions. Zero public or unencrypted transfer is allowed."
      },
      {
        id: `chunk_gr_1`,
        chapter: "Culture & Values",
        category: "Corporate Integration Guardrail",
        title: "Communication Transparency",
        text: "TE Values - Teamwork and Integrity: Do not announce payroll adjustments, organizational transitions, or redundancies unilaterally. Any workforce restructure must be approved by the IMO steering committee and local HR leads. Always prioritize supportive, open, and transparent employee communication."
      },
      {
        id: `chunk_gr_2`,
        chapter: "Compensation, Benefits & Talent Retention",
        category: "Strict Regulatory Guardrail",
        title: "Retention Lock-Ins and Equity Conversion",
        text: "Retention & Compensation Policy: All key retention contracts (R&D leads, key sales accounts) must be aligned to TE standardized compensation bands by Day 30. Equity conversions from target companies must strictly adhere to the SEC filings and board approval guidelines. Avoid individual or informal side-agreements."
      }
    ];

    // Load custom RAG uploaded snippets from db.json
    let customChunks = [];
    const dbPath = path.join(__dirname, 'db.json');
    if (fs.existsSync(dbPath)) {
      try {
        const dbData = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        if (dbData.ragUploads && Array.isArray(dbData.ragUploads)) {
          let customChunkCounter = 0;
          dbData.ragUploads.forEach(upload => {
            if (upload.suggestedRags && Array.isArray(upload.suggestedRags)) {
              upload.suggestedRags.forEach(rag => {
                customChunks.push({
                  id: `chunk_custom_${upload.id}_${customChunkCounter++}`,
                  chapter: rag.chapter || "M&A Regulatory & Legal Compliance",
                  category: "Uploaded AI Training Snippet",
                  title: rag.title || "Custom Guideline",
                  text: rag.text || ""
                });
              });
            }
          });
        }
      } catch (dbErr) {
        console.error("RAG Indexer: Failed to read custom uploads from db.json:", dbErr);
      }
    }

    documentCorpus = [...chunks, ...strictGuardrails, ...customChunks];
    buildTfIdfIndex();
    
    console.log(`RAG Initialization Complete: Loaded and indexed ${documentCorpus.length} high-fidelity integration playbook snippets (including ${customChunks.length} custom trained chunks).`);
    return true;
  } catch (error) {
    console.error("RAG Indexer initialization error:", error);
    return false;
  }
}

/**
 * Maps division ID to user-friendly chapter name
 */
function getChapterDisplayName(id) {
  const mapping = {
    intro: "Introduction & Overview",
    culture: "Culture & Values Alignment",
    talent: "Talent & Systems Onboarding",
    value: "Value & Synergies Capture",
    imo: "IMO Operational Best Practices"
  };
  return mapping[id] || id;
}

/**
 * Builds the TF-IDF index for the corpus
 */
function buildTfIdfIndex() {
  const N = documentCorpus.length;
  const idfCounts = {};
  
  const chunksWithTf = documentCorpus.map(doc => {
    const tokens = tokenize(doc.text);
    const termFreqs = {};
    
    tokens.forEach(token => {
      termFreqs[token] = (termFreqs[token] || 0) + 1;
    });
    
    // Add unique words to IDF calculation
    Object.keys(termFreqs).forEach(token => {
      idfCounts[token] = (idfCounts[token] || 0) + 1;
    });
    
    return {
      doc,
      tf: termFreqs,
      tokenCount: tokens.length
    };
  });
  
  // Calculate IDF
  const idf = {};
  Object.keys(idfCounts).forEach(token => {
    // Standard IDF formula: log(1 + N / DF)
    idf[token] = Math.log(1 + N / idfCounts[token]);
  });
  
  tfIdfModel = {
    chunks: chunksWithTf,
    idf: idf
  };
}

/**
 * Search the index for matching playbook snippets and rank them
 */
function searchPlaybook(query, limit = 3) {
  if (documentCorpus.length === 0) {
    initializeRAG();
  }
  
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    // If empty query, return top chunks from important sections
    return documentCorpus.slice(0, limit);
  }
  
  const scoredChunks = tfIdfModel.chunks.map(chunkItem => {
    let score = 0;
    
    queryTokens.forEach(token => {
      if (chunkItem.tf[token]) {
        // Term frequency normalized by total tokens in document
        const tf = chunkItem.tf[token] / chunkItem.tokenCount;
        const idf = tfIdfModel.idf[token] || 0;
        
        // TF-IDF boost
        score += tf * idf;
      }
    });
    
    // Boost matching exact keywords in titles or chapters
    const titleLower = chunkItem.doc.title.toLowerCase();
    const chapterLower = chunkItem.doc.chapter.toLowerCase();
    queryTokens.forEach(token => {
      if (titleLower.includes(token)) score += 0.5;
      if (chapterLower.includes(token)) score += 0.3;
    });
    
    return {
      chunk: chunkItem.doc,
      score: score
    };
  });
  
  // Sort descending and filter out zero-score items unless all are zero
  let results = scoredChunks
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);
    
  // Fallback: If no matches, return general guidelines or the first few items
  if (results.length === 0) {
    results = scoredChunks.slice(0, limit);
  } else {
    results = results.slice(0, limit);
  }
  
  return results.map(item => ({
    ...item.chunk,
    searchScore: item.score.toFixed(4)
  }));
}

/**
 * Retrieve contextual paragraphs and pack them into a structured prompt context
 */
function retrieveRagContext(query, limit = 3) {
  const matches = searchPlaybook(query, limit);
  
  let formattedContext = "=========================================================\n";
  formattedContext += "TE CONNECTIVITY CORPORATE INTEGRATION PLAYBOOK SNIPPETS & COMPLIANCE GUARDRAILS:\n";
  formattedContext += "Use the following retrieved corporate playbooks and regulatory guidelines to shape your advice,\n";
  formattedContext += "set strict compliance guardrails, and avoid violating corporate policies.\n";
  formattedContext += "=========================================================\n\n";
  
  matches.forEach((match, index) => {
    formattedContext += `[SNIPPET #${index + 1}] Chapter: "${match.chapter}" | Topic: "${match.title}" (RAG Relevance Score: ${match.searchScore || 'N/A'})\n`;
    formattedContext += `Guideline Text: ${match.text}\n\n`;
  });
  
  formattedContext += "=========================================================\n";
  formattedContext += "CRITICAL MANDATE: Integrate these RAG-retrieved guidelines and regulatory guardrails directly in the plan sections\n";
  formattedContext += "(especially under Phased Roadmap, HR Modules, and Coaching Scenarios). Ensure corporate compliance is fully addressed.\n";
  formattedContext += "=========================================================\n";
  
  return {
    formattedText: formattedContext,
    snippets: matches
  };
}

// Automatically load corpus on load
initializeRAG();

module.exports = {
  initializeRAG,
  searchPlaybook,
  retrieveRagContext
};
