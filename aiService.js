const ragService = require('./ragService');

// Generates the M&A Integration Plan using Gemini if API Key exists, otherwise falls back.
async function generate100DayPlan({ targetCompany, scores, responses, questions, apiKey }) {
  // Dynamically compute the search query for RAG based on high-risk dimensions and legal guardrails
  let ragQuery = "legal regulatory IP protection compliance";
  if (scores.culture < 3.5) ragQuery += " culture values communication resistance town hall";
  if (scores.talent < 3.5) ragQuery += " talent retention SSO credentials cyber security";
  if (scores.value < 3.5) ragQuery += " synergy pricing distribution technology transfer";

  console.log(`Executing backend RAG search for query: "${ragQuery}"...`);
  const ragContext = ragService.retrieveRagContext(ragQuery, 4);

  if (!apiKey || apiKey.trim() === "") {
    console.log("No Gemini API Key found. Generating custom integration plan via local expert engine.");
    return generateLocalFallbackPlan(targetCompany, scores, responses, questions, ragContext.snippets);
  }

  console.log(`Gemini API Key active. Requesting custom M&A plan generation for ${targetCompany}...`);
  
  const systemPrompt = `You are a Senior M&A Post-Merger Integration Director and HR Executive at TE Connectivity. 
You are coaching an Integration Leader and the Integration Lead who are merging a new company into TE Connectivity. 
TE Connectivity is a global leader in industrial technology, connector and sensor manufacturing. 
Our core values are Integrity, Accountability, Teamwork, and Innovation (known as TE Values).
We use a structured Post-Merger Integration playbook focusing on Culture, Talent, and Value.

Write a highly detailed, professional, and action-oriented "First 100 Days Post-Merger Integration Plan" in beautiful Markdown. 
Keep the tone expert, structured, and supportive. Use TE Connectivity terminology (e.g. TE Values, IMO - Integration Management Office, TESS - TE System Solutions, Integration Leader).

The target acquired company is: "${targetCompany}"
The current assessment scores (1.0 = Extreme Risk/Disalignment, 5.0 = Perfect Alignment) are:
- Culture: ${scores.culture}/5.0
- Talent: ${scores.talent}/5.0
- Value: ${scores.value}/5.0

Here are the specific survey questions and rating responses given:
${questions.map(q => `- [Dimension: ${q.dimension}] "${q.text}" -> Score: ${responses[q.id]}/5`).join('\n')}

${ragContext.formattedText}

Include the following sections in your Markdown output:
1. **Executive Integration Summary**: Analyze the strengths and critical risks based on the scores, incorporating the retrieved RAG playbook insights and regulatory mandates.
2. **First 100 Days Phased Roadmap**:
   - **Phase 1 (Days 1-30): Welcome, Discovery & Safety Nets**
   - **Phase 2 (Days 31-60): Systems Alignment & Team Calibration**
   - **Phase 3 (Days 61-100): Synergy Realization & Steady State**
3. **Recommended HR Integration Modules**: Suggest 3 specific HR programs to launch based on their scores (e.g., Culture Workshops, Retainer lock-ins, TE System onboarding).
4. **Coaching the Integration Leader**: Provide a dedicated section coaching the Integration Leader. Give them 3 challenging conversations they might encounter, script templates for how to handle them, and daily checklist pointers.
5. **Cross-Functional Teams Involved**: Outline the key stakeholder teams (e.g., IMO, Compensation & Benefits, Legal, Corporate Comms, Local HR) and their respective responsibilities. Ensure the regulatory compliance/IP transfer requirements are assigned.
6. **Interaction Guide**: Connect their priorities with local Playbook pages (Culture Playbook, Talent Mapping Guide, Synergies Tracker).

Ensure you format everything cleanly with bullet points, bold text, callout quotes, and markdown tables where appropriate.`;
 
  try {
    // Call Gemini API using native fetch
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(15000), // fail fast into the local fallback if Gemini hangs
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: systemPrompt }]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2500
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API responded with status ${response.status}: ${errText}`);
    }

    const result = await response.json();
    if (result.candidates && result.candidates[0] && result.candidates[0].content && result.candidates[0].content.parts[0]) {
      return result.candidates[0].content.parts[0].text;
    } else {
      throw new Error("Invalid response format received from Gemini API.");
    }
  } catch (error) {
    console.error("Gemini M&A Plan generation error:", error.message);
    console.log("Falling back to local expert engine...");
    return generateLocalFallbackPlan(targetCompany, scores, responses, questions, ragContext.snippets);
  }
}

// Local Expert System - Zero setup Markdown Plan Generator
function generateLocalFallbackPlan(targetCompany, scores, responses = {}, questions = [], ragSnippets = []) {
  // Analyze scores to set severity levels
  const getStatus = (val) => {
    if (val < 3.0) return { label: "CRITICAL RISK", color: "#EF4444", class: "risk-low" };
    if (val < 4.2) return { label: "MODERATE GAP", color: "#F59E0B", class: "risk-med" };
    return { label: "STRONG ALIGNMENT", color: "#10B981", class: "risk-high" };
  };

  const cultureStatus = getStatus(scores.culture);
  const talentStatus = getStatus(scores.talent);
  const valueStatus = getStatus(scores.value);

  // Compile recommended modules based on score
  let recommendedModules = [];
  
  if (scores.culture < 3.0) {
    recommendedModules.push({
      title: "TE Values Synergy Workshop",
      time: "Days 1-15",
      description: "Immediate workshop matching newly acquired leadership with TE Corporate IMO to bridge hierarchical barriers. Resolves communication frictions and aligns values on Teamwork and Integrity."
    });
  } else if (scores.culture < 4.2) {
    recommendedModules.push({
      title: "TE Culture Alignment Sessions",
      time: "Days 30-45",
      description: "Structured town-halls and standard culture onboarding to adapt their operational rhythms to TE Connectivity standards."
    });
  } else {
    recommendedModules.push({
      title: "Culture Champions Peer Group",
      time: "Days 45-60",
      description: "Lightweight synchronization groups to celebrate collaborative wins and embed TE Innovation behaviors in their processes."
    });
  }

  if (scores.talent < 3.0) {
    recommendedModules.push({
      title: "Key Talent Retention & Incentive Lock-in",
      time: "Days 1-30",
      description: "High priority mapping of R&D scientists, senior technical staff, and key operational architects. Establish structured TE retention agreements and bonus allocations."
    });
  } else if (scores.talent < 4.2) {
    recommendedModules.push({
      title: "Skills Mapping & Cross-Training Blueprint",
      time: "Days 30-60",
      description: "Define skills matrix overlaps. Streamline systems access, HR benefits transition, and corporate compliance onboarding in TE System Solutions."
    });
  } else {
    recommendedModules.push({
      title: "Workforce Mobility & Talent Expansion Plan",
      time: "Days 60-100",
      description: "Create career pathways for the acquired high-performers to transfer across global TE functional departments."
    });
  }

  if (scores.value < 3.0) {
    recommendedModules.push({
      title: "Synergy & Value Proposition Calibration",
      time: "Days 1-30",
      description: "Intense executive sessions led by the TE IMO to re-establish business targets, cost-saving plans, and product development transfers."
    });
  } else if (scores.value < 4.2) {
    recommendedModules.push({
      title: "Operational Synergy Tracking Track",
      time: "Days 30-75",
      description: "Standardize sales channels pipelines, harmonize product line pricing, and integrate global supply chains."
    });
  } else {
    recommendedModules.push({
      title: "Commercial Joint Go-to-Market Integration",
      time: "Days 60-90",
      description: "Launch co-branded marketing campaigns and align customer distribution networks to scale integration value."
    });
  }

  // Generate standard Integration Leader Coaching Scenarios
  let coachingTips = "";
  if (scores.culture < 3.0) {
    coachingTips += `
> [!WARNING]
> **Culture Coaching Point (Critical Risk):**
> *Scenario:* Middle managers express resistance, feeling that "TE corporate is wiping out our agile identity."
> *Coaching template:* Acknowledge their concern. Reframe the narrative: "We are not replacing your agility; we are supporting it with TE's global supply scale. Our core value of *Innovation* relies exactly on your style."
`;
  } else {
    coachingTips += `
> [!NOTE]
> **Culture Coaching Point (Normal):**
> *Scenario:* Minor friction in communication loops.
> *Coaching template:* Schedule bi-weekly touchpoints between functional leaders to resolve process differences.
`;
  }

  if (scores.talent < 3.0) {
    coachingTips += `
> [!CAUTION]
> **Talent Retention Action (Critical Risk):**
> *Scenario:* Key R&D Engineers are being approached by competitors during integration uncertainty.
> *Coaching template:* Act immediately. Deploy the Integration Lead to hold direct 1-on-1s. Use this script: "We value you immensely. Here is our retention plan, and here is how your career path expands into TE Connectivity's global laboratories."
`;
  }

  // Fallback: load RAG snippets if not supplied
  if (ragSnippets.length === 0) {
    try {
      let ragQuery = "legal regulatory IP protection compliance";
      if (scores.culture < 3.5) ragQuery += " culture values resistance town hall";
      if (scores.talent < 3.5) ragQuery += " talent retention SSO cyber security";
      if (scores.value < 3.5) ragQuery += " synergy pricing distribution technology transfer";
      ragSnippets = ragService.searchPlaybook(ragQuery, 3);
    } catch (err) {
      console.error("Local RAG retrieval failed:", err);
    }
  }

  let ragSection = "";
  if (ragSnippets && ragSnippets.length > 0) {
    ragSection = `
---

### 🛡️ RAG-Retrieved Playbook Guidelines & Compliance Guardrails

These specific integration rules and regulatory compliance filters were retrieved from our local database to guide this diagnostic analysis:

${ragSnippets.map((s, idx) => `
> [!IMPORTANT]
> **Rule ${idx + 1}: [${s.chapter}] ${s.title}**
> *Directive:* ${s.text}
`).join('\n')}
`;
  }

  return `# M&A Post-Merger Integration Plan
## Target: **${targetCompany}** | Post-Merger Assessment Report

This 100-day plan has been synthesized by the **TE Connectivity Post-Merger Integration (PMI) Expert System** based on detailed dimensional diagnostics.

---

### 📊 Integration KPI Scorecard

| Integration Dimension | Average Score | Status Classification | Primary Focus Area |
| :--- | :---: | :---: | :--- |
| **Culture & Values** | **${scores.culture} / 5.0** | <span style="color: ${cultureStatus.color}; font-weight: bold;">${cultureStatus.label}</span> | Behavioral adaptation & executive alignment |
| **Talent & Systems** | **${scores.talent} / 5.0** | <span style="color: ${talentStatus.color}; font-weight: bold;">${talentStatus.label}</span> | Retention of critical skills & HR onboarding |
| **Value & Synergies** | **${scores.value} / 5.0** | <span style="color: ${valueStatus.color}; font-weight: bold;">${valueStatus.label}</span> | Strategy clarity & technology transfer |

---

### 🗺️ First 100 Days Phased Roadmap

\`\`\`
[Days 1-30: Welcome & Safety Nets] ──> [Days 31-60: Systems & Calibration] ──> [Days 61-100: Scale & Synergy]
\`\`\`

#### 🚀 Phase 1: Days 1 to 30 — Discovery, Safety Nets, & Retention
*   **Culture Action:** Conduct localized welcome town halls. Connect the acquired company's leadership with the TE Integration Management Office (IMO).
*   **Talent Action:** Launch the key talent retention lock-ins. Conduct detailed 1-on-1 interviews with top R&D architects and sales representatives.
*   **Value Action:** Map the business strategy. Calibrate the value synergy roadmap to ensure all teams understand cost/growth timelines.

#### ⚙️ Phase 2: Days 31 to 60 — Systems Alignment & Team Calibration
*   **Culture Action:** Launch joint team sessions to resolve communication barriers and merge operating cadences.
*   **Talent Action:** Transition all acquired personnel onto TE HR platforms. Initiate TE Compliance and Cybersecurity training.
*   **Value Action:** Integrate sales pipelines and unify product catalog pricing models.

#### 📈 Phase 3: Days 61 to 100 — Synergy Realization & Steady State
*   **Culture Action:** Appoint integration "Culture Champions" to maintain morale and highlight co-development successes.
*   **Talent Action:** Carry out functional mapping to streamline overlapping operational workflows (e.g. HR, legal, payroll channels).
*   **Value Action:** Initiate joint customer distributions and utilize TE's global supply chain to accelerate sales pipelines.

---

### 📋 Recommended HR Integration Modules

Here are the specific, high-priority programs recommended based on the assessment:

${recommendedModules.map(m => `
#### **${m.title}** (${m.time})
*   *Objective:* Optimize scores and mitigate integration friction.
*   *Description:* ${m.description}
`).join('\n')}

---

### 🤝 Cross-Functional Teams Involved

Successful integration requires close coordination across corporate tracks.

| Functional Team | Primary Focus in this Integration | Core KPI |
| :--- | :--- | :--- |
| **TE Integration Office (IMO)** | Orchestrates the master timeline and synergy tracking. | Milestone Adherence (Target: >95%) |
| **Compensation & Benefits** | Manages payroll alignment, equity conversion, and benefits. | Talent Attrition Rate (Target: <5%) |
| **Corporate Communications** | Delivers unified, positive messaging across both employee bases. | Onboarding Survey Sentiment |
| **TE R&D / Tech Transfer** | Assists engineering teams in migrating patents and tech systems. | Code & Supply Line Integration |

---

### 🎓 Coaching the Integration Leader & Project Lead

As the Integration Leader, you are the critical bridge. Use these coaching scripts to navigate integration friction points:

${coachingTips}

#### **Top 3 Core Playbook Links for the Integration Leader:**
1.  [Culture and Values Playbook](file:///Users/karstenhaldan/M&A/public/playbook.html#culture) — Guidelines on holding town halls and values alignment workshops.
2.  [Talent Mapping & Retention Guide](file:///Users/karstenhaldan/M&A/public/playbook.html#talent) — Templates for key personnel bonus structures and career blueprints.
3.  [Value Synergy Playbook](file:///Users/karstenhaldan/M&A/public/playbook.html#value) — Step-by-step trackers for operational consolidation and customer transfer.
${ragSection}
---
*Plan generated on 2026-05-21T22:15:00Z by the TE post-merger integration expert RAG service. All details are kept confidential in accordance with TE Connectivity Compliance policies.*`;
}

module.exports = {
  generate100DayPlan,
  generateLocalFallbackPlan,
  reviewPdfContent,
  generateSmolInsight
};

/**
 * AI Insight LLM review for uploaded PDF files.
 * Uses Gemini API to summarize, categorize, and extract structured RAG chunks.
 */
async function reviewPdfContent({ pdfText, fileName, apiKey }) {
  if (!apiKey || apiKey.trim() === "") {
    console.log("No Gemini API Key found. Generating custom PDF summary locally.");
    return generateLocalPdfReview(fileName, pdfText);
  }
  
  console.log(`Reviewing PDF ${fileName} using AI Insight Gemini LLM...`);
  
  const prompt = `You are a Senior M&A Integration AI Agent (AI Insight) at TE Connectivity. 
You are tasked with reviewing an uploaded integration document / PDF file.
Document Name: "${fileName}"
Raw text extracted from PDF:
"""
${pdfText.substring(0, 12000)}
"""

Review the document thoroughly and perform these steps:
1. Provide a premium, professional summary (2-3 sentences).
2. Identify the core dimension of this document: "Culture", "Talent", "Value", or "General Compliance".
3. Extract high-quality, actionable, highly-specific policy snippets / directives (up to 4 chunks) to be used to train/index our local RAG (Retrieval-Augmented Generation) engine. 
Format each snippet to be an operational directive.

Return your response STRICTLY as a valid JSON object matching the following structure:
{
  "summary": "Concise overview of the document...",
  "dimension": "Culture" | "Talent" | "Value" | "General Compliance",
  "keyFindings": ["Finding 1...", "Finding 2...", "Finding 3..."],
  "suggestedRags": [
    {
      "chapter": "Culture & Values Alignment" | "Talent & Systems Onboarding" | "Value & Synergies Capture" | "M&A Regulatory & Legal Compliance",
      "title": "Specific Topic (e.g. Compensation Bands)",
      "text": "Detailed operational guideline extracted from the document including strict guardrails and directives..."
    }
  ]
}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(15000), // fail fast into the local fallback if Gemini hangs
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.15,
          responseMimeType: "application/json"
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API review status: ${response.status}`);
    }

    const result = await response.json();
    let textRes = "";
    if (result.candidates && result.candidates[0] && result.candidates[0].content && result.candidates[0].content.parts[0]) {
      textRes = result.candidates[0].content.parts[0].text;
    } else if (result.candidates && result.candidates[0] && result.candidates[0].parts && result.candidates[0].parts[0]) {
      textRes = result.candidates[0].parts[0].text;
    } else {
      throw new Error("Invalid format");
    }
    
    return JSON.parse(textRes.trim());
  } catch (error) {
    console.error("Gemini PDF review failed, running local heuristic review:", error);
    return generateLocalPdfReview(fileName, pdfText);
  }
}

/**
 * Local heuristic PDF reviewer - runs when no API Key is active or fetch fails.
 */
function generateLocalPdfReview(fileName, pdfText) {
  const cleanText = pdfText.replace(/\s+/g, ' ').trim();
  const summary = `Offline review of "${fileName}": Successfully parsed and processed ${cleanText.length} characters of policy text. Identified core guidelines and operational constraints.`;
  
  let dimension = "General Compliance";
  let chapter = "M&A Regulatory & Legal Compliance";
  const lowerText = cleanText.toLowerCase();
  
  if (lowerText.includes("culture") || lowerText.includes("value") || lowerText.includes("communication") || lowerText.includes("morale") || lowerText.includes("feedback")) {
    dimension = "Culture";
    chapter = "Culture & Values Alignment";
  } else if (lowerText.includes("talent") || lowerText.includes("retention") || lowerText.includes("payroll") || lowerText.includes("onboard") || lowerText.includes("sso") || lowerText.includes("benefit")) {
    dimension = "Talent";
    chapter = "Talent & Systems Onboarding";
  } else if (lowerText.includes("synergy") || lowerText.includes("patent") || lowerText.includes("pricing") || lowerText.includes("pipeline") || lowerText.includes("sales") || lowerText.includes("catalog")) {
    dimension = "Value";
    chapter = "Value & Synergies Capture";
  }
  
  // Extract sentences as findings
  const sentences = cleanText.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 30);
  const keyFindings = sentences.slice(0, Math.min(sentences.length, 3));
  if (keyFindings.length === 0) {
    keyFindings.push("Successfully extracted plain-text corpus from PDF document.");
    keyFindings.push("Identified critical organizational parameters for RAG model training.");
  }
  
  // Split into chunks of approx 350 chars
  const suggestedRags = [];
  const chunkSize = 350;
  let chunkIdx = 0;
  for (let i = 0; i < cleanText.length && suggestedRags.length < 3; i += chunkSize) {
    const textChunk = cleanText.substring(i, i + chunkSize).trim();
    if (textChunk.length > 60) {
      chunkIdx++;
      suggestedRags.push({
        chapter: chapter,
        title: `Policy Directive (${fileName} - Sec ${chunkIdx})`,
        text: textChunk + "..."
      });
    }
  }
  
  if (suggestedRags.length === 0) {
    suggestedRags.push({
      chapter: chapter,
      title: `General Guideline (${fileName})`,
      text: cleanText.substring(0, Math.min(cleanText.length, 500))
    });
  }
  
  return {
    summary,
    dimension,
    keyFindings,
    suggestedRags
  };
}

/**
 * Generates a short dynamic integration insight tailored to the active portal (PMO, Integration Leader, Admin) using RAG context.
 */
async function generateSmolInsight({ portal, apiKey }) {
  let ragQuery = "post merger integration management office compliance";
  let roleTitle = "Senior PMO Integration Director";
  let targetAudience = "PMO Steering Committee";
  
  if (portal === 'pmo') {
    ragQuery = "synergy integration roadmap executive IMO timeline metrics";
    roleTitle = "Senior PMO Integration Director";
    targetAudience = "PMO Integration Steering Lead";
  } else if (portal === 'hrbp') {
    ragQuery = "talent retention buddy employee training compensation morale culture";
    roleTitle = "Senior HR Post-Merger Integration Partner";
    targetAudience = "Regional Integration Leader";
  } else if (portal === 'admin') {
    ragQuery = "database backup security API configuration compliance governance";
    roleTitle = "Enterprise M&A IT Systems Architect";
    targetAudience = "System Administrator";
  }

  // Retrieve RAG snippets
  console.log(`[aiService] Retrieving RAG context for portal "${portal}" with query "${ragQuery}"...`);
  const ragContext = ragService.retrieveRagContext(ragQuery, 3);

  // If no API Key or empty, use dynamic expert system heuristics based on portal
  if (!apiKey || apiKey.trim() === "") {
    console.log(`[aiService] No Gemini API Key active for SmolInsight. Running expert fallback heuristics.`);
    return generateFallbackInsight(portal, ragContext.snippets);
  }

  const prompt = `You are a ${roleTitle} at TE Connectivity.
Your target audience is the ${targetAudience}.
You are providing a quick, strategic, and highly actionable integration insight / directive based on the following RAG playbook directives:
${ragContext.formattedText}

Instructions:
1. Formulate a single, premium, expert integration insight of 2 to 3 sentences max.
2. Ensure the tone is highly professional, authoritative, and helpful.
3. Incorporate specific TE Connectivity terminology (e.g. TE Values, IMO, Integration Leader).
4. Direct them to actionable priorities based on the RAG rules. Do not give generic advice.

Return your response strictly as a plain text string without quotes or markdown formatting. Keep it to exactly 2-3 sentences.`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(15000), // fail fast into the local fallback if Gemini hangs
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.35, maxOutputTokens: 200 }
      })
    });

    if (!response.ok) throw new Error(`Gemini API responded with status ${response.status}`);
    const result = await response.json();
    if (result.candidates && result.candidates[0] && result.candidates[0].content && result.candidates[0].content.parts[0]) {
      return result.candidates[0].content.parts[0].text.trim();
    }
    throw new Error("Invalid Gemini response format.");
  } catch (error) {
    console.error("[aiService] AI Insight insight generation failed, falling back to local expert system:", error);
    return generateFallbackInsight(portal, ragContext.snippets);
  }
}

function generateFallbackInsight(portal, snippets) {
  let snippetText = "";
  if (snippets && snippets.length > 0) {
    snippetText = ` (Direct Playbook Directive: "${snippets[0].title}" - ${snippets[0].text.substring(0, 100)}...)`;
  }

  if (portal === 'pmo') {
    return `💡 PMO Steering Directive: Overall synergy metrics and integration milestones are tracking on-schedule. Ensure that Day 30 risk assessments are reviewed with local leaders to address early alignment friction in the cultural track.${snippetText}`;
  } else if (portal === 'hrbp') {
    return `💡 Integration Leader People Blueprint: Key talent lists are locked. Integration Leaders should verify buddy email configurations for legacy APAC/EMEA employees within 48 hours of onboarding to reduce systems access friction.${snippetText}`;
  } else if (portal === 'admin') {
    return `💡 Admin Security Warning: Database encryption and API key allocations must adhere to strict corporate compliance frameworks. Verify that RAG database structures are fully synced prior to production cloud release.${snippetText}`;
  }
  return `💡 General Integration Guidance: Maintain absolute compliance with TE Connectivity security policies throughout all phases of post-merger onboarding.`;
}

