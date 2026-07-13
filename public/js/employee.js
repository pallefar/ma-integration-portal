/**
 * TE Connectivity M&A Integration Portal - employee.js
 * Controls URL variable extraction, personalized timelining, welcome video customizer & player,
 * full multi-language translations (EN, DE, ZH, CS), and the brand-new Acquisition
 * Training Academy & Gamification Engine (XP, Levels, rewards, and leaderboards).
 */

document.addEventListener('DOMContentLoaded', () => {
  
  // 1. Extract URL query parameters
  const params = new URLSearchParams(window.location.search);
  const empId = params.get('empId') || 'emp_' + Math.random().toString(36).substring(2, 9);
  const name = params.get('name') || "Valued Team Member";
  const role = params.get('role') || "Team Specialist";
  const dept = params.get('dept') || "Operations";
  const company = params.get('company') || "NextGen Sensors";

  // Active welcome video settings holder
  const activeVideoSettings = {
    welcomeVideoUrl: "",
    welcomeVideoType: "local"
  };

  let activeEmployee = null;
  let portalSettings = {
    doomGloballyEnabled: true,
    doomUnlockXp: 220
  };

  // --- 2. MULTI-LANGUAGE TRANSLATION MATRIX ---
  const TRANSLATIONS = {
    en: {
      welcome_title: "Welcome to the TE Connectivity Family!",
      welcome_personal: "Welcome to the TE Connectivity Family, {name}!",
      welcome_subtitle: "{role} ── {dept} ({company} Integration)",
      tab_academy: "🎓 Onboarding Training Academy",
      tab_roadmap: "🗺️ 100-Day Phased Roadmap",
      tab_onboarding: "🚀 Onboarding",
      tab_culture: "🎭 Your TE",
      tab_roles: "👤 Roles",
      tab_communication: "📣 Communication",
      culture_section_heading: "🎭 Your TE Alignment & Values",
      video_title: "Welcome Message from TE Executive IMO Director",
      video_duration: "Play Video &bull; 3:15 min",
      video_alert_title: "M&A Video Integration Service",
      video_alert_body: '"On behalf of TE Connectivity, welcome! Your talent, knowledge, and innovation are what make this merger so powerful. Together, we will build connectivity systems that enable autonomous vehicles, smart factories, and medical technologies worldwide. Here is what to expect in your first 100 days..."',
      video_alert_tip: "💡 *Admin Tip: To link your own executive MP4 or YouTube onboarding welcome video, edit the public video source within <code>public/employee.html</code>.*",
      roadmap_title: "Your First 100 Days Roadmap",
      roadmap_desc: "We have structured your integration path into three core stages. Track your progress with these essential checklists:",
      pulse_title: "Your Onboarding Health Check: 30-Day Pulse Survey",
      pulse_success_title: "Feedback Submitted!",
      pulse_success_desc: "Thank you for checking in. Your satisfaction is key to our combined success.",
      pulse_desc: "How is your integration experience so far? Please click a rating number from 1 (poor) to 5 (excellent) and share your onboarding thoughts.",
      pulse_label: "Overall Onboarding Satisfaction",
      pulse_comments_label: "Share Your Thoughts",
      pulse_comments_placeholder: "Tell us about systems setup, payroll alignments, or if you need immediate Integration Leader assistance...",
      pulse_submit: "Submit Onboarding Feedback",
      pulse_submit_submitting: "Submitting Feedback...",
      pulse_notify: "Receive critical integration news alerts and calendar meeting updates via simulated email channels.",
      video_modal_title: "Edit Welcome Video Source",
      video_modal_type: "Video Source Type",
      video_modal_url: "Video URL / Path",
      video_modal_help: "For local videos, use a web-accessible directory. For YouTube, paste the standard YouTube watch URL or shared link.",
      btn_cancel: "Cancel",
      btn_save: "Save Changes",
      submenu_academy: "🎓 Onboarding Academy",
      submenu_roadmap: "🗺️ Phased Roadmap",
      submenu_pulse: "📊 Pulse Survey",
      submenu_helpdesk: "💬 HR Helpdesk",
      
      alert_1_title: "📅 Post-Merger Integration Review Meeting",
      alert_1_message: "Join the Integration Management Office for the bi-weekly Post-Merger calibration sync on MS Teams. May 26, 14:00 CET.",
      alert_2_title: "🛡️ TE Cybersecurity Systems Compliance Course",
      alert_2_message: "All newly acquired employees must complete the basic cybersecurity and compliance training within their first 30 days.",
      alert_3_title: "📣 Cultural Integration Welcome Town Hall",
      alert_3_message: "Join TE corporate executives and local leads for a combined welcome session and open Q&A. May 25, 10:00 CET.",
 
      // Sidebars/HR helpdesk card
      hr_title: "HR Questions?",
      hr_desc: "Transitioning companies can bring up questions regarding benefits, payroll conversion schedules, or systems transfers. Submit your inquiry below:",
      hr_success_title: "Inquiry Received!",
      hr_success_desc: "Your local Integration Leader will review this ticket and get back to you within 24 hours.",
      hr_subject_label: "Subject Area",
      hr_subject_benefits: "Benefits & Pension Onboarding",
      hr_subject_payroll: "Payroll & Tax Transition",
      hr_subject_systems: "IT Accounts & Security Access",
      hr_subject_reporting: "Organizational Reporting Structure",
      hr_subject_other: "General HR Inquiry",
      hr_msg_label: "Explain Your Question",
      hr_msg_placeholder: "Explain your alignment query here...",
      hr_submit: "Submit to Integration Leader",
      hr_submitting: "Submitting Ticket...",
      
      // Milestones and Leaderboards
      milestones_header: "🔒 Milestone Retention Rewards",
      leaderboard_header: "🏆 Acquired Team Leaderboard",
      leaderboard_connecting: "Connecting leaderboard stands...",
      badge_new_recruit: "New Recruit",
      badge_culture_champion: "Culture Champion",
      badge_systems_scholar: "Systems Scholar",
      badge_synergy_scout: "Synergy Scout",
      badge_ultimate_integrator: "Ultimate Integrator",
      
      // Sidebar tracks
      sidebar_tracks_title: "Integration Tracks",
      sidebar_sales_title: "Sales Integration",
      sidebar_sales_desc: "Customer catalog mergers & CRM pricing channels.",
      sidebar_product_title: "Product & Patents",
      sidebar_product_desc: "Engineering blueprint migrations and patent databases.",
      sidebar_finance_title: "Finance & Taxes",
      sidebar_finance_desc: "Corporate fiscal calendars and tax consolidation ERPs.",
      status_pre_onboarding: "Pre-Onboarding",
      read_playbook_link: "📖 Read Playbook Section &rarr;",
      
      // Tracks badge strings
      track_rd: "R&D & Engineering Track",
      track_sales: "Sales & Commercial Track",
      track_finance: "Finance & Administration Track",
      track_general: "General Integration Track",
      integration: "Integration",
      track: "Track",
      days_1_30: "Days 1 to 30",
      days_31_60: "Days 31 to 60",
      days_61_100: "Days 61 to 100",
      
      // Academy curriculum translations
      academy_progress_title: "Academy Progress Matrix",
      academy_completed: "{completed} completed",
      academy_total: "9 lessons total",
      academy_m1_title: "Module 1: TE Values & Collaboration",
      academy_m1_subtitle: "Your TE Dimension &bull; Earn +20 XP per Lesson",
      academy_m1_badge: "Your TE",
      academy_l1_1_title: "Lesson 1.1: Welcome & Core TE Values",
      academy_l1_1_desc: "Understand the 4 core TE pillars: Integrity, Accountability, Teamwork, and Innovation.",
      academy_l1_2_title: "Lesson 1.2: Rhythms & Communication Channels",
      academy_l1_2_desc: "Learn about company-wide newsletters, MS Teams etiquette, and recurring IMO town halls.",
      academy_l1_3_title: "Lesson 1.3: Integration Town Hall Highlights",
      academy_l1_3_desc: "Watch key clips from the CEO town hall and find answers to common merger questions.",
      
      academy_m2_title: "Module 2: Systems, Access & Compliance",
      academy_m2_subtitle: "Talent & Systems Dimension &bull; Earn +20 XP per Lesson",
      academy_m2_badge: "Systems",
      academy_l2_1_title: "Lesson 2.1: SSO Credentials & Network Setup",
      academy_l2_1_desc: "Set up your secure TE Single Sign-On and activate standard network credentials.",
      academy_l2_2_title: "Lesson 2.2: Benefits Transition & Enrollment",
      academy_l2_2_desc: "Explore healthcare migration plans and select retirement contribution profiles.",
      academy_l2_3_title: "Lesson 2.3: Cybersecurity & Compliance Onboarding",
      academy_l2_3_desc: "Complete basic compliance certificates and understand IP protection protocols.",

      academy_m3_title: "Module 3: Growth & Synergy Capture",
      academy_m3_subtitle: "Value Dimension &bull; Earn +20 XP per Lesson",
      academy_m3_badge: "Synergy",
      academy_l3_1_title: "Lesson 3.1: Synergy Strategy & Catalog Capture",
      academy_l3_1_desc: "Learn about the commercial rationale for the acquisition and combined catalog highlights.",
      academy_l3_2_title: "Lesson 3.2: Technology Transfer & Patents",
      academy_l3_2_desc: "Synchronize patent filing procedures and adapt co-development safety checklists.",
      academy_l3_3_title: "Lesson 3.3: Joint Sales Margins & Channels",
      academy_l3_3_desc: "Map regional sales boundaries and learn client transfer procedures.",

      diagnostic_culture_warning: "Diagnostic Priority Action: Culture dimension score is critical",
      diagnostic_talent_warning: "Diagnostic Priority Action: Systems & Compliance score is critical",
      diagnostic_value_warning: "Diagnostic Priority Action: Synergy & Value score is critical",

      milestone_welcome_kit: "Welcome Merch Kit",
      milestone_welcome_kit_desc: "TE T-Shirt, Tech Tumbler, TEodor Duck Sticker.",
      milestone_certified_badge: "Certified Integrator Badge",
      milestone_certified_badge_desc: "Official Digital Badge & Certificate.",
      milestone_bonus_tier: "Retention Bonus Tier 1",
      milestone_bonus_tier_desc: "Unlocks eligibility for post-merger integration bonus.",
      milestone_spotlight: "IMO Spotlight Showcase",
      milestone_spotlight_desc: "Featured employee profile in standard IMO newsletter.",
      milestone_doom: "TEd Gateway",
      milestone_doom_desc: "Unlock the custom retro corporate ladder 2D platformer game TEd.",
      badge_promotion_title: "Badge Promotion!",
      badge_promotion_subtitle: "You have achieved the rank of",
      btn_awesome: "Awesome!",

      // Static hero / calendar / sidebar headers (previously untranslated)
      hero_badge_label: "👋 Personal Onboarding Space",
      hero_description: "Your personalized integration hub for your first 100 days. Complete your training curriculum, view target roadmap milestones, submit pulse checks, and connect directly with local Integration Leader support.",
      stat_training_status: "Training Status",
      stat_onboarding_health: "Pulse Health",
      events_hub_title: "TE Integration Events & Activity Hub",
      next_upcoming_event_label: "Next Upcoming Event:",
      expand_calendar: "Expand Calendar",
      selected_day_event: "SELECTED DAY'S EVENT",
      no_event_selected: "Click a calendar day to see integration events, town halls, or system training courses scheduled.",
      upcoming_integration_events: "UPCOMING EVENTS TIMELINE",
      notification_title: "Urgent Integration Steering Alerts",
      did_you_know_title: "Did You Know?",
      next_tip: "Next Fact",

      // Hero stat values & footer
      hero_stat_training_value: "Active &bull; Module 1",
      hero_stat_pulse_value: "Synced ✅",
      footer_copyright: "&copy; 2026 <strong>TE Connectivity</strong>. All rights reserved. Post-Merger Integration IMO System.",

      // Culture tab values
      culture_values_body: "TE Connectivity operates under four core values: <strong>Integrity</strong>, <strong>Accountability</strong>, <strong>Teamwork</strong>, and <strong>Innovation</strong>. We are committed to establishing a collaborative environment during this integration.",
      culture_collab_note: "<strong>💡 Collaborative Strategy:</strong> Participate in local town halls and team syncs to connect with your new peers and learn about TE global business channels.",

      // Roles tab
      roles_profile_heading: "👤 Employee Integration Profile",
      roles_full_name: "Full Name",
      roles_assigned_title: "Assigned Title / Role",
      roles_track_dept: "Integration Track Department",
      roles_system_email: "System User Email",
      roles_buddy_heading: "🤝 Assigned Integration Buddy",
      roles_buddy_help: "Your integration buddy is here to help you get settled, gain access to software resources, and navigate internal channels.",
      roles_buddy_contact: "💬 Contact Buddy through Slack/Teams",

      // Communication tab (static fallback cards)
      comm_archive_title: "📣 Digital Broadcast Archive",
      comm_archive_intro: "Official notifications, policy announcements, and integration guides dispatched to your email matching your profile track.",
      comm_card1_title: "Welcome to the TE Network",
      comm_day_1: "Day 1",
      comm_card1_body: "Your TE credentials and network access instructions have been fully provisioned. Please review the attached guide to connect your devices to the global intranet.",
      comm_view_attachment: "View Attachment (PDF)",
      comm_card2_title: "Action Required: Compliance Training",
      comm_day_15: "Day 15",
      comm_card2_body: "As part of the integration, all acquired staff must complete the TE Ethics & Compliance certification. Log into the academy portal to begin.",
      comm_go_academy: "Go to Academy",
      comm_card3_title: "Global Townhall Invitation",
      comm_day_30: "Day 30",
      comm_card3_body: "Join the executive leadership team for our quarterly global townhall, where we will welcome our newly integrated teams.",

      // Video modal source options
      video_opt_local: "Local Video File (MP4, WebM)",
      video_opt_youtube: "YouTube Video Embedded URL or Link",

      // Notifications toggle
      notif_collapse: "Collapse",
      notif_expand: "Expand",

      // Calendar & events
      calendar_month: "May 2026",
      event_type_news: "NEWS",
      event_type_meeting: "MEETING",
      event_type_training: "TRAINING",
      all_day: "All Day",
      cal_no_event: "No integration events scheduled for {date}. Click another highlighted day!",
      cal_no_upcoming: "No upcoming events in the timeline.",
      cal_e1_title: "Day 1 Kickoff & Welcome Breakfast",
      cal_e1_desc: "Welcome breakfast in the lobby, site leader address, and distribution of physical Welcome Kits!",
      cal_e2_title: "IT Accounts SSO Registration",
      cal_e2_desc: "Deadline to complete SSO registration and activate your new TE corporate email inbox.",
      cal_e3_title: "Q&A Session with IMO Integration Lead",
      cal_e3_desc: "Drop-in virtual session to ask questions about system conversions and payroll transitions.",
      cal_e4_title: "Cultural Integration Welcome Town Hall",
      cal_e4_desc: "Join TE corporate executives and local leads for a combined welcome session and open Q&A. May 25, 10:00 CET.",
      cal_e5_title: "Post-Merger Integration Review Meeting",
      cal_e5_desc: "Join the Integration Management Office for the bi-weekly Post-Merger calibration sync on MS Teams. May 26, 14:00 CET.",
      cal_e6_title: "TE Cybersecurity Systems Compliance Course",
      cal_e6_desc: "All newly acquired employees must complete the basic cybersecurity and compliance training within their first 30 days."
    },
    de: {
      welcome_title: "Willkommen in der TE Connectivity Familie!",
      welcome_personal: "Willkommen in der TE Connectivity Familie, {name}!",
      welcome_subtitle: "{role} ── {dept} ({company}-Integration)",
      tab_academy: "🎓 Onboarding-Schulungsakademie",
      tab_roadmap: "🗺️ 100-Tage-Roadmap in Phasen",
      tab_onboarding: "🚀 Onboarding",
      tab_culture: "🎭 Ihr TE",
      tab_roles: "👤 Rollen",
      tab_communication: "📣 Kommunikation",
      culture_section_heading: "🎭 Ihr TE: Ausrichtung & Werte",
      video_title: "Begrüßungsbotschaft des TE Executive IMO Directors",
      video_duration: "Video abspielen &bull; 3:15 Min.",
      video_alert_title: "M&A-Video-Integrationsdienst",
      video_alert_body: '"Im Namen von TE Connectivity, herzlich willkommen! Ihr Talent, Ihr Wissen und Ihre Innovation machen diesen Zusammenschluss so stark. Gemeinsam werden wir Verbindungssysteme bauen, die autonome Fahrzeuge, intelligente Fabriken und Medizintechnik weltweit ermöglichen. Das erwartet Sie in Ihren ersten 100 Tagen..."',
      video_alert_tip: "💡 *Admin-Tipp: Um Ihr eigenes Begrüßungsvideo im MP4- oder YouTube-Format zu verlinken, bearbeiten Sie die öffentliche Videoquelle in <code>public/employee.html</code>.*",
      roadmap_title: "Ihre 100-Tage-Roadmap",
      roadmap_desc: "Wir haben Ihren Integrationspfad in drei Kernphasen unterteilt. Verfolgen Sie Ihren Fortschritt mit diesen wichtigen Checklisten:",
      pulse_title: "Ihr Onboarding-Gesundheitscheck: 30-Tage-Pulse-Umfrage",
      pulse_success_title: "Feedback übermittelt!",
      pulse_success_desc: "Vielen Dank für Ihre Rückmeldung. Ihre Zufriedenheit ist der Schlüssel zu unserem gemeinsamen Erfolg.",
      pulse_desc: "Wie ist Ihre bisherige Integrationserfahrung? Bitte klicken Sie auf eine Bewertung von 1 (schlecht) bis 5 (hervorragend) und teilen Sie Ihre Gedanken zum Onboarding mit.",
      pulse_label: "Gesamte Zufriedenheit beim Onboarding",
      pulse_comments_label: "Teilen Sie Ihre Gedanken",
      pulse_comments_placeholder: "Erzählen Sie uns von der Systemeinrichtung, der Gehaltsabrechnung oder ob Sie sofortige Integration Leader-Unterstützung benötigen...",
      pulse_submit: "Onboarding-Feedback senden",
      pulse_submit_submitting: "Feedback wird übermittelt...",
      pulse_notify: "Erhalten Sie wichtige Integrations-News und Kalender-Updates in simulierten E-Mail-Kanälen.",
      video_modal_title: "Videoquelle bearbeiten",
      video_modal_type: "Videoquellentyp",
      video_modal_url: "Video-URL / Pfad",
      video_modal_help: "Verwenden Sie für lokale Videos ein über das Web zugängliches Verzeichnis. Fügen Sie für YouTube die Standard-YouTube-URL oder den Freigabelink ein.",
      btn_cancel: "Abbrechen",
      btn_save: "Änderungen speichern",
      submenu_academy: "🎓 Onboarding-Akademie",
      submenu_roadmap: "🗺️ Phased Roadmap",
      submenu_pulse: "📊 Pulse-Umfrage",
      submenu_helpdesk: "💬 HR-Helpdesk",
      
      alert_1_title: "📅 Post-Merger-Integrations-Review-Meeting",
      alert_1_message: "Nehmen Sie am zweiwöchentlichen Post-Merger-Kalibrierungs-Sync des Integration Management Office auf MS Teams teil. 26. Mai, 14:00 Uhr MEZ.",
      alert_2_title: "🛡️ TE Cybersecurity-System-Compliance-Kurs",
      alert_2_message: "Alle neu übernommenen Mitarbeiter müssen in den ersten 30 Tagen die grundlegende Cybersicherheits- und Compliance-Schulung absolvieren.",
      alert_3_title: "📣 Willkommens-Town-Hall zur kulturellen Integration",
      alert_3_message: "Nehmen Sie an einer gemeinsamen Willkommens-Session mit TE-Führungskräften und lokalen Leitern sowie einer offenen Fragerunde teil. 25. Mai, 10:00 Uhr MEZ.",

      // Sidebars/HR helpdesk card
      hr_title: "Fragen an die Personalabteilung?",
      hr_desc: "Der Übergang zwischen Unternehmen kann Fragen zu Leistungen, Zeitplänen für die Gehaltsumstellung oder Systemübertragungen aufwerfen. Reichen Sie Ihre Anfrage unten ein:",
      hr_success_title: "Anfrage erhalten!",
      hr_success_desc: "Ihr lokaler Integration Leader wird dieses Ticket prüfen und sich innerhalb von 24 Stunden bei Ihnen melden.",
      hr_subject_label: "Fachbereich",
      hr_subject_benefits: "Einführung in Sozialleistungen & Altersvorsorge",
      hr_subject_payroll: "Gehaltsabrechnung & Steuerübergang",
      hr_subject_systems: "IT-Konten & Sicherheitszugang",
      hr_subject_reporting: "Organisatorische Berichtsstruktur",
      hr_subject_other: "Allgemeine HR-Anfrage",
      hr_msg_label: "Erklären Sie Ihre Frage",
      hr_msg_placeholder: "Erklären Sie hier Ihre Ausrichtungsfrage...",
      hr_submit: "An Integration Leader senden",
      hr_submitting: "Ticket wird übermittelt...",
      
      // Milestones and Leaderboards
      milestones_header: "🔒 Meilenstein-Mitarbeiterprämien",
      leaderboard_header: "🏆 Bestenliste des übernommenen Teams",
      leaderboard_connecting: "Verbindung zur Bestenliste wird hergestellt...",
      badge_new_recruit: "Neuer Rekrut",
      badge_culture_champion: "Kultur-Champion",
      badge_systems_scholar: "System-Gelehrter",
      badge_synergy_scout: "Synergie-Scout",
      badge_ultimate_integrator: "Ultimativer Integrator",
      
      // Sidebar tracks
      sidebar_tracks_title: "Integrationspfade",
      sidebar_sales_title: "Vertriebsintegration",
      sidebar_sales_desc: "Fusionen von Kundenkatalogen & CRM-Preiskanäle.",
      sidebar_product_title: "Produkt & Patente",
      sidebar_product_desc: "Migrationen von technischen Entwürfen und Patentdatenbanken.",
      sidebar_finance_title: "Finanzen & Steuern",
      sidebar_finance_desc: "Unternehmenssteuerkalender und ERPs zur Steuerkonsolidierung.",
      status_pre_onboarding: "Vorbereitung",
      read_playbook_link: "📖 Playbook-Abschnitt lesen &rarr;",
      
      // Tracks badge strings
      track_rd: "Forschung & Entwicklung Pfad",
      track_sales: "Vertriebs- & Geschäftspfad",
      track_finance: "Finanz- & Verwaltungspfad",
      track_general: "Allgemeiner Integrationspfad",
      integration: "Integration",
      track: "Pfad",
      days_1_30: "Tage 1 bis 30",
      days_31_60: "Tage 31 bis 60",
      days_61_100: "Tage 61 bis 100",
      
      // Academy curriculum translations
      academy_progress_title: "Akademie-Fortschrittsmatrix",
      academy_completed: "{completed} abgeschlossen",
      academy_total: "9 Lektionen insgesamt",
      academy_m1_title: "Modul 1: TE Werte & Zusammenarbeit",
      academy_m1_subtitle: "Ihr TE Bereich &bull; Verdienen Sie +20 XP pro Lektion",
      academy_m1_badge: "Ihr TE",
      academy_l1_1_title: "Lektion 1.1: Willkommen & TE-Grundwerte",
      academy_l1_1_desc: "Verstehen Sie die 4 TE-Grundpfeiler: Integrität, Rechenschaftspflicht, Teamarbeit und Innovation.",
      academy_l1_2_title: "Lektion 1.2: Rhythmen & Kommunikationskanäle",
      academy_l1_2_desc: "Erfahren Sie mehr über unternehmensweite Newsletter, MS Teams-Etikette und IMO Town Halls.",
      academy_l1_3_title: "Lektion 1.3: Highlights des Integration Town Halls",
      academy_l1_3_desc: "Sehen Sie sich Clips aus dem CEO Town Hall an und finden Sie Antworten auf häufige Fragen.",
      
      academy_m2_title: "Modul 2: Systeme, Zugriff & Compliance",
      academy_m2_subtitle: "Talent- & Systemdimension &bull; Verdienen Sie +20 XP pro Lektion",
      academy_m2_badge: "Systeme",
      academy_l2_1_title: "Lektion 2.1: SSO-Zugangsdaten & Netzwerkeinrichtung",
      academy_l2_1_desc: "Richten Sie Ihr sicheres TE Single Sign-On ein und aktivieren Sie Standardnetzwerke.",
      academy_l2_2_title: "Lektion 2.2: Übergang & Registrierung von Leistungen",
      academy_l2_2_desc: "Erkunden Sie Krankenversicherungspläne und wählen Sie Profile für die Altersvorsorge.",
      academy_l2_3_title: "Lektion 2.3: Cybersicherheit & Compliance-Einführung",
      academy_l2_3_desc: "Schließen Sie Compliance-Zertifikate ab und verstehen Sie IP-Schutzprotokolle.",

      academy_m3_title: "Modul 3: Wachstum & Synergieerfassung",
      academy_m3_subtitle: "Wertdimension &bull; Verdienen Sie +20 XP pro Lektion",
      academy_m3_badge: "Synergie",
      academy_l3_1_title: "Lektion 3.1: Synergiestrategie & Katalogerfassung",
      academy_l3_1_desc: "Erfahren Sie mehr über die kommerziellen Gründe für die Übernahme und Katalog-Highlights.",
      academy_l3_2_title: "Lektion 3.2: Technologietransfer & Patente",
      academy_l3_2_desc: "Synchronisieren Sie Patentanmeldeverfahren und passen Sie Sicherheitschecklisten an.",
      academy_l3_3_title: "Lektion 3.3: Gemeinsame Vertriebsmargen & Kanäle",
      academy_l3_3_desc: "Ordnen Sie regionale Vertriebsgrenzen zu und lernen Sie Kundenübertragungsverfahren.",

      diagnostic_culture_warning: "Diagnostische Prioritätsmaßnahme: Die Kulturdimension ist kritisch",
      diagnostic_talent_warning: "Diagnostische Prioritätsmaßnahme: Die System- & Compliance-Bewertung ist kritisch",
      diagnostic_value_warning: "Diagnostische Prioritätsmaßnahme: Die Synergie- & Wertbewertung ist kritisch",

      milestone_welcome_kit: "Willkommens-Merch-Kit",
      milestone_welcome_kit_desc: "TE T-Shirt, Thermobecher, TEodor Enten-Aufkleber.",
      milestone_certified_badge: "Zertifiziertes Integrator-Abzeichen",
      milestone_certified_badge_desc: "Offizielles digitales Abzeichen und Zertifikat.",
      milestone_bonus_tier: "Mitarbeiterbindungsbonus Stufe 1",
      milestone_bonus_tier_desc: "Schaltet die Berechtigung für den Integrationsbonus nach der Fusion frei.",
      milestone_spotlight: "IMO-Spotlight-Präsentation",
      milestone_spotlight_desc: "Vorgestelltes Mitarbeiterprofil im standardmäßigen IMO-Newsletter.",
      milestone_doom: "TEd Gateway",
      milestone_doom_desc: "Schalte das benutzerdefinierte Retro-2D-Plattformspiel TEd zur Integration frei.",
      badge_promotion_title: "Abzeichen-Beförderung!",
      badge_promotion_subtitle: "Sie haben den folgenden Rang erreicht:",
      btn_awesome: "Großartig!",

      // Static hero / calendar / sidebar headers (previously untranslated)
      hero_badge_label: "👋 Persönlicher Onboarding-Bereich",
      hero_description: "Ihr persönlicher Integrations-Hub für Ihre ersten 100 Tage. Absolvieren Sie Ihren Schulungsplan, sehen Sie Roadmap-Meilensteine ein, senden Sie Pulse-Checks und wenden Sie sich direkt an die lokale Integration-Leader-Unterstützung.",
      stat_training_status: "Schulungsstatus",
      stat_onboarding_health: "Pulse-Status",
      events_hub_title: "TE Integrations-Events & Aktivitäts-Hub",
      next_upcoming_event_label: "Nächste anstehende Veranstaltung:",
      expand_calendar: "Kalender ausklappen",
      selected_day_event: "VERANSTALTUNG DES AUSGEWÄHLTEN TAGES",
      no_event_selected: "Klicken Sie auf einen Kalendertag, um geplante Integrationsveranstaltungen, Town Halls oder System-Schulungen anzuzeigen.",
      upcoming_integration_events: "ZEITLEISTE ANSTEHENDER VERANSTALTUNGEN",
      notification_title: "Dringende Integrations-Steuerungshinweise",
      did_you_know_title: "Wussten Sie schon?",
      next_tip: "Nächster Fakt",

      // Hero stat values & footer
      hero_stat_training_value: "Aktiv &bull; Modul 1",
      hero_stat_pulse_value: "Synchronisiert ✅",
      footer_copyright: "&copy; 2026 <strong>TE Connectivity</strong>. Alle Rechte vorbehalten. Post-Merger-Integrations-IMO-System.",

      // Culture tab values
      culture_values_body: "TE Connectivity handelt nach vier Grundwerten: <strong>Integrität</strong>, <strong>Verantwortung</strong>, <strong>Teamarbeit</strong> und <strong>Innovation</strong>. Wir setzen uns dafür ein, während dieser Integration ein kooperatives Umfeld zu schaffen.",
      culture_collab_note: "<strong>💡 Kooperationsstrategie:</strong> Nehmen Sie an lokalen Town Halls und Team-Syncs teil, um Ihre neuen Kollegen kennenzulernen und die globalen Geschäftsbereiche von TE zu entdecken.",

      // Roles tab
      roles_profile_heading: "👤 Mitarbeiter-Integrationsprofil",
      roles_full_name: "Vollständiger Name",
      roles_assigned_title: "Zugewiesener Titel / Rolle",
      roles_track_dept: "Integrationspfad-Abteilung",
      roles_system_email: "System-Benutzer-E-Mail",
      roles_buddy_heading: "🤝 Zugewiesener Integrations-Buddy",
      roles_buddy_help: "Ihr Integrations-Buddy hilft Ihnen, sich einzuleben, Zugang zu Software-Ressourcen zu erhalten und interne Kanäle zu navigieren.",
      roles_buddy_contact: "💬 Buddy über Slack/Teams kontaktieren",

      // Communication tab (static fallback cards)
      comm_archive_title: "📣 Digitales Broadcast-Archiv",
      comm_archive_intro: "Offizielle Benachrichtigungen, Richtlinienankündigungen und Integrationsleitfäden, die an Ihre E-Mail passend zu Ihrem Profilpfad gesendet werden.",
      comm_card1_title: "Willkommen im TE-Netzwerk",
      comm_day_1: "Tag 1",
      comm_card1_body: "Ihre TE-Zugangsdaten und Anweisungen für den Netzwerkzugang wurden vollständig bereitgestellt. Bitte lesen Sie den beigefügten Leitfaden, um Ihre Geräte mit dem globalen Intranet zu verbinden.",
      comm_view_attachment: "Anhang ansehen (PDF)",
      comm_card2_title: "Aktion erforderlich: Compliance-Schulung",
      comm_day_15: "Tag 15",
      comm_card2_body: "Im Rahmen der Integration müssen alle übernommenen Mitarbeiter die TE-Ethik- und Compliance-Zertifizierung abschließen. Melden Sie sich im Akademie-Portal an, um zu beginnen.",
      comm_go_academy: "Zur Akademie",
      comm_card3_title: "Einladung zur globalen Town Hall",
      comm_day_30: "Tag 30",
      comm_card3_body: "Nehmen Sie mit dem Führungsteam an unserer vierteljährlichen globalen Town Hall teil, bei der wir unsere neu integrierten Teams willkommen heißen.",

      // Video modal source options
      video_opt_local: "Lokale Videodatei (MP4, WebM)",
      video_opt_youtube: "Eingebettete YouTube-Video-URL oder Link",

      // Notifications toggle
      notif_collapse: "Einklappen",
      notif_expand: "Ausklappen",

      // Calendar & events
      calendar_month: "Mai 2026",
      event_type_news: "NEWS",
      event_type_meeting: "MEETING",
      event_type_training: "SCHULUNG",
      all_day: "Ganztägig",
      cal_no_event: "Keine Integrationsveranstaltungen für {date} geplant. Klicken Sie auf einen anderen markierten Tag!",
      cal_no_upcoming: "Keine bevorstehenden Veranstaltungen in der Zeitleiste.",
      cal_e1_title: "Tag 1: Kickoff & Willkommensfrühstück",
      cal_e1_desc: "Willkommensfrühstück in der Lobby, Ansprache der Standortleitung und Verteilung der physischen Willkommenspakete!",
      cal_e2_title: "SSO-Registrierung für IT-Konten",
      cal_e2_desc: "Frist für den Abschluss der SSO-Registrierung und die Aktivierung Ihres neuen TE-Firmen-E-Mail-Postfachs.",
      cal_e3_title: "Q&A-Sitzung mit dem IMO Integration Lead",
      cal_e3_desc: "Offene virtuelle Sitzung für Fragen zu Systemumstellungen und Gehaltsübergängen.",
      cal_e4_title: "Willkommens-Town-Hall zur kulturellen Integration",
      cal_e4_desc: "Nehmen Sie an einer gemeinsamen Willkommens-Session mit TE-Führungskräften und lokalen Leitern sowie einer offenen Fragerunde teil. 25. Mai, 10:00 Uhr MEZ.",
      cal_e5_title: "Post-Merger-Integrations-Review-Meeting",
      cal_e5_desc: "Nehmen Sie am zweiwöchentlichen Post-Merger-Kalibrierungs-Sync des Integration Management Office auf MS Teams teil. 26. Mai, 14:00 Uhr MEZ.",
      cal_e6_title: "TE Cybersecurity-System-Compliance-Kurs",
      cal_e6_desc: "Alle neu übernommenen Mitarbeiter müssen in den ersten 30 Tagen die grundlegende Cybersicherheits- und Compliance-Schulung absolvieren."
    },
    zh: {
      welcome_title: "欢迎加入 TE Connectivity 大家庭！",
      welcome_personal: "欢迎加入 TE Connectivity 大家庭，{name}！",
      welcome_subtitle: "{role} ── {dept} ({company} 整合)",
      tab_academy: "🎓 入职培训学院",
      tab_roadmap: "🗺️ 百日阶段性路线图",
      tab_onboarding: "🚀 入职培训",
      tab_culture: "🎭 您的 TE",
      tab_roles: "👤 角色",
      tab_communication: "📣 沟通",
      culture_section_heading: "🎭 您的 TE：协同与价值观",
      video_title: "TE 执行 IMO 总监的欢迎致辞",
      video_duration: "播放视频 &bull; 3:15 分钟",
      video_alert_title: "并购视频整合服务",
      video_alert_body: '"我代表 TE Connectivity 欢迎大家！你们的才华、知识和创新正是这次合并如此强大的原因。我们将共同构建连接系统，支持全球的自动驾驶汽车、智能工厂和医疗技术。以下是您在入职前 100 天可以期待的内容..."',
      video_alert_tip: "💡 *管理员提示：要链接您自己的高管 MP4 或 YouTube 入职欢迎视频，请编辑 <code>public/employee.html</code> 中的公共视频源。*",
      roadmap_title: "您的前 100 天路线图",
      roadmap_desc: "我们将您的整合路径分为三个核心阶段。使用这些关键清单跟踪您的进度：",
      pulse_title: "入职健康状况检查：30 天脉搏调查",
      pulse_success_title: "反馈已提交！",
      pulse_success_desc: "感谢您的反馈。您的满意是我们共同成功的关键。",
      pulse_desc: "到目前为止，您的整合体验如何？请点击 1（差）到 5（优秀）的评分，并分享您的入职想法。",
      pulse_label: "整体入职满意度",
      pulse_comments_label: "分享您的想法",
      pulse_comments_placeholder: "告诉我们关于系统设置、薪资调整的情况，或者您是否需要整合负责人 (Integration Leader) 的即时协助...",
      pulse_submit: "提交入职反馈",
      pulse_submit_submitting: "正在提交反馈...",
      pulse_notify: "通过模拟电子邮件渠道接收关键合并新闻警报和日历会议更新。",
      video_modal_title: "编辑欢迎视频源",
      video_modal_type: "视频源类型",
      video_modal_url: "视频 URL / 路径",
      video_modal_help: "对于本地视频，请使用可通过网络访问的目录。对于 YouTube，请粘贴标准的 YouTube 观看网址或分享链接。",
      btn_cancel: "取消",
      btn_save: "保存更改",
      submenu_academy: "🎓 入职培训学院",
      submenu_roadmap: "🗺️ 阶段路线图",
      submenu_pulse: "📊 脉搏调查",
      submenu_helpdesk: "💬 人事服务台",
      
      alert_1_title: "📅 并购后整合审查会议",
      alert_1_message: "加入整合管理办公室，在 MS Teams 上进行每两周一次的并购后校准同步。5 月 26 日，欧洲中部时间 14:00。",
      alert_2_title: "🛡️ TE 网络安全系统合规课程",
      alert_2_message: "所有新加入的员工必须在入职前 30 天内完成基础网络安全 and 合规培训。",
      alert_3_title: "📣 文化整合欢迎全员大会",
      alert_3_message: "加入 TE 企业高管和本地负责人的联合欢迎会及公开问答环节。5 月 25 日，欧洲中部时间 10:00。",

      // Sidebars/HR helpdesk card
      hr_title: "有 HR 问题？",
      hr_desc: "公司过渡可能会带来关于福利、薪资转换时间表或系统转移的问题。请在下方提交您的咨询：",
      hr_success_title: "咨询已收到！",
      hr_success_desc: "您当地的 Integration Leader 将审查此工单并在 24 小时内回复您。",
      hr_subject_label: "主题领域",
      hr_subject_benefits: "福利与养老金入职",
      hr_subject_payroll: "薪资与税务过渡",
      hr_subject_systems: "IT 账户与安全访问",
      hr_subject_reporting: "组织汇报结构",
      hr_subject_other: "一般 HR 咨询",
      hr_msg_label: "说明您的问题",
      hr_msg_placeholder: "在此说明您的调整查询...",
      hr_submit: "提交给 Integration Leader",
      hr_submitting: "正在提交工单...",
      
      // Milestones and Leaderboards
      milestones_header: "🔒 里程碑保留奖励",
      leaderboard_header: "🏆 被收购团队排行榜",
      leaderboard_connecting: "正在连接排行榜...",
      badge_new_recruit: "新员工",
      badge_culture_champion: "文化捍卫者",
      badge_systems_scholar: "系统学者",
      badge_synergy_scout: "协同先锋",
      badge_ultimate_integrator: "终极整合者",
      
      // Sidebar tracks
      sidebar_tracks_title: "整合轨道",
      sidebar_sales_title: "销售整合",
      sidebar_sales_desc: "客户目录合并与 CRM 定价渠道。",
      sidebar_product_title: "产品与专利",
      sidebar_product_desc: "工程蓝图迁移和专利数据库。",
      sidebar_finance_title: "财务与税务",
      sidebar_finance_desc: "企业财政日历和税务合并 ERP。",
      status_pre_onboarding: "入职前准备",
      read_playbook_link: "📖 阅读指南章节 &rarr;",
      
      // Tracks badge strings
      track_rd: "研发与工程轨道",
      track_sales: "销售与商业轨道",
      track_finance: "财务与行政轨道",
      track_general: "通用整合轨道",
      integration: "整合",
      track: "轨道",
      days_1_30: "第 1 到 30 天",
      days_31_60: "第 31 到 60 天",
      days_61_100: "第 61 到 100 天",
      
      // Academy curriculum translations
      academy_progress_title: "培训学院进度矩阵",
      academy_completed: "已完成 {completed} 项",
      academy_total: "共 9 节课",
      academy_m1_title: "模块 1：TE 价值观与协作",
      academy_m1_subtitle: "您的 TE 维度 &bull; 每完成一课获得 +20 XP",
      academy_m1_badge: "您的 TE",
      academy_l1_1_title: "课 1.1：欢迎与核心 TE 价值观",
      academy_l1_1_desc: "了解 TE 的 4 大核心支柱：诚信、担当、合作和创新。",
      academy_l1_2_title: "课 1.2：工作节奏与沟通渠道",
      academy_l1_2_desc: "了解公司范围的简报、MS Teams 礼仪和定期 IMO 全员大会。",
      academy_l1_3_title: "课 1.3：整合全员大会亮点",
      academy_l1_3_desc: "观看首席执行官全员大会的关键剪辑，并寻找常见合并问题的答案。",
      
      academy_m2_title: "模块 2：系统、访问与合规性",
      academy_m2_subtitle: "人才与系统维度 &bull; 每完成一课获得 +20 XP",
      academy_m2_badge: "系统",
      academy_l2_1_title: "课 2.1：SSO 凭据与网络设置",
      academy_l2_1_desc: "设置您安全的 TE 单点登录并激活标准网络凭据。",
      academy_l2_2_title: "课 2.2：福利过渡与加入",
      academy_l2_2_desc: "探索医疗保健迁移计划并选择退休金缴纳配置。",
      academy_l2_3_title: "课 2.3：网络安全与合规入职培训",
      academy_l2_3_desc: "完成基础合规证书并了解知识产权保护协议。",

      academy_m3_title: "模块 3：增长与协同效益捕获",
      academy_m3_subtitle: "价值维度 &bull; 每完成一课获得 +20 XP",
      academy_m3_badge: "协同",
      academy_l3_1_title: "课 3.1：协同战略与目录捕获",
      academy_l3_1_desc: "了解收购的商业合理性以及合并目录的亮点。",
      academy_l3_2_title: "课 3.2：技术转让与专利",
      academy_l3_2_desc: "同步专利申请程序并调整共同开发安全清单。",
      academy_l3_3_title: "课 3.3：联合销售利润率与渠道",
      academy_l3_3_desc: "规划区域销售边界并学习客户转移程序。",

      diagnostic_culture_warning: "诊断优先行动：文化维度得分处于关键状态",
      diagnostic_talent_warning: "诊断优先行动：系统与合规得分处于关键状态",
      diagnostic_value_warning: "诊断优先行动：协同与价值得分处于关键状态",

      milestone_welcome_kit: "欢迎新员工大礼包",
      milestone_welcome_kit_desc: "TE T恤、科技保温杯、TEodor 小鸭子贴纸。",
      milestone_certified_badge: "认证整合者徽章",
      milestone_certified_badge_desc: "官方数字徽章和证书。",
      milestone_bonus_tier: "保留奖金第 1 档",
      milestone_bonus_tier_desc: "解锁并购后整合奖金的领取资格。",
      milestone_spotlight: "IMO 焦点展示",
      milestone_spotlight_desc: "在标准的 IMO 通讯中展示员工个人资料。",
      milestone_doom: "TEd 复古传送门",
      milestone_doom_desc: "解锁自定义复古新员工晋升 2D 横版闯关游戏 TEd。",
      badge_promotion_title: "徽章晋升！",
      badge_promotion_subtitle: "您已获得以下军衔：",
      btn_awesome: "太棒了！",

      // Static hero / calendar / sidebar headers (previously untranslated)
      hero_badge_label: "👋 个人入职空间",
      hero_description: "您头 100 天的个性化整合中心。完成您的培训课程、查看目标路线图里程碑、提交脉搏调查，并直接联系本地整合负责人 (Integration Leader) 的支持。",
      stat_training_status: "培训状态",
      stat_onboarding_health: "脉搏健康度",
      events_hub_title: "TE 整合活动中心",
      next_upcoming_event_label: "下一个即将举行的活动：",
      expand_calendar: "展开日历",
      selected_day_event: "所选日期的活动",
      no_event_selected: "点击日历中的某一天，查看已安排的整合活动、全员大会或系统培训课程。",
      upcoming_integration_events: "即将举行的活动时间线",
      notification_title: "紧急整合指导提醒",
      did_you_know_title: "您知道吗？",
      next_tip: "下一条",

      // Hero stat values & footer
      hero_stat_training_value: "进行中 &bull; 模块 1",
      hero_stat_pulse_value: "已同步 ✅",
      footer_copyright: "&copy; 2026 <strong>TE Connectivity</strong>。保留所有权利。并购后整合 IMO 系统。",

      // Culture tab values
      culture_values_body: "TE Connectivity 秉持四大核心价值观：<strong>诚信</strong>、<strong>担当</strong>、<strong>合作</strong>与<strong>创新</strong>。我们致力于在本次整合期间营造协作的环境。",
      culture_collab_note: "<strong>💡 协作策略：</strong>参加本地全员大会和团队同步会，结识新同事并了解 TE 的全球业务渠道。",

      // Roles tab
      roles_profile_heading: "👤 员工整合档案",
      roles_full_name: "全名",
      roles_assigned_title: "分配的职衔 / 角色",
      roles_track_dept: "整合轨道部门",
      roles_system_email: "系统用户电子邮箱",
      roles_buddy_heading: "🤝 指定的整合伙伴",
      roles_buddy_help: "您的整合伙伴将帮助您安顿下来、获取软件资源并熟悉内部沟通渠道。",
      roles_buddy_contact: "💬 通过 Slack/Teams 联系伙伴",

      // Communication tab (static fallback cards)
      comm_archive_title: "📣 数字广播存档",
      comm_archive_intro: "根据您的档案轨道，发送到您电子邮箱的官方通知、政策公告和整合指南。",
      comm_card1_title: "欢迎加入 TE 网络",
      comm_day_1: "第 1 天",
      comm_card1_body: "您的 TE 凭据和网络访问说明已完全配置。请查阅随附指南，将您的设备连接到全球内联网。",
      comm_view_attachment: "查看附件 (PDF)",
      comm_card2_title: "需采取行动：合规培训",
      comm_day_15: "第 15 天",
      comm_card2_body: "作为整合的一部分，所有被收购员工必须完成 TE 道德与合规认证。请登录学院门户以开始。",
      comm_go_academy: "前往学院",
      comm_card3_title: "全球全员大会邀请",
      comm_day_30: "第 30 天",
      comm_card3_body: "加入高管领导团队参加我们的季度全球全员大会，我们将在会上欢迎新整合的团队。",

      // Video modal source options
      video_opt_local: "本地视频文件 (MP4、WebM)",
      video_opt_youtube: "YouTube 视频嵌入网址或链接",

      // Notifications toggle
      notif_collapse: "折叠",
      notif_expand: "展开",

      // Calendar & events
      calendar_month: "2026 年 5 月",
      event_type_news: "新闻",
      event_type_meeting: "会议",
      event_type_training: "培训",
      all_day: "全天",
      cal_no_event: "{date} 没有安排整合活动。请点击另一个高亮的日期！",
      cal_no_upcoming: "时间线上没有即将举行的活动。",
      cal_e1_title: "第 1 天启动与欢迎早餐",
      cal_e1_desc: "在大堂举行欢迎早餐、站点负责人致辞，并发放实体欢迎礼包！",
      cal_e2_title: "IT 账户 SSO 注册",
      cal_e2_desc: "完成 SSO 注册并激活您新的 TE 企业电子邮箱的截止日期。",
      cal_e3_title: "与 IMO 整合负责人的问答环节",
      cal_e3_desc: "随时参加的线上环节，就系统转换和薪资过渡提出问题。",
      cal_e4_title: "文化整合欢迎全员大会",
      cal_e4_desc: "加入 TE 企业高管和本地负责人的联合欢迎会及公开问答环节。5 月 25 日，欧洲中部时间 10:00。",
      cal_e5_title: "并购后整合审查会议",
      cal_e5_desc: "加入整合管理办公室，在 MS Teams 上进行每两周一次的并购后校准同步。5 月 26 日，欧洲中部时间 14:00。",
      cal_e6_title: "TE 网络安全系统合规课程",
      cal_e6_desc: "所有新加入的员工必须在入职前 30 天内完成基础网络安全与合规培训。"
    },
    cs: {
      welcome_title: "Vítejte v rodině TE Connectivity!",
      welcome_personal: "Vítejte v rodině TE Connectivity, {name}!",
      welcome_subtitle: "{role} ── {dept} (Integrace {company})",
      tab_academy: "🎓 Vzdělávací akademie pro onboarding",
      tab_roadmap: "🗺️ Fázový plán na prvních 100 dní",
      tab_onboarding: "🚀 Onboarding",
      tab_culture: "🎭 Vaše TE",
      tab_roles: "👤 Role",
      tab_communication: "📣 Komunikace",
      culture_section_heading: "🎭 Vaše TE: Sladění a hodnoty",
      video_title: "Uvítací zpráva od výkonného ředitele TE IMO",
      video_duration: "Přehrát video &bull; 3:15 min",
      video_alert_title: "Integrační videoslužba M&A",
      video_alert_body: '"Jménem společnosti TE Connectivity vás vítám! Váš talent, znalosti a inovace jsou tím, co činí tuto fúzi tak silnou. Společně budeme budovat propojovací systémy, které umožňují autonomní vozidla, chytré továrny a lékařské technologie po celém světě. Zde je to, co můžete očekávat v prvních 100 dnech..."',
      video_alert_tip: "💡 *Tip pro administrátory: Chcete-li propojit vlastní uvítací video ve formátu MP4 nebo YouTube, upravte veřejný zdroj videa v souboru <code>public/employee.html</code>.*",
      roadmap_title: "Plán na vašich prvních 100 dní",
      roadmap_desc: "Vaši integrační cestu jsme rozdělili do tří hlavních fází. Sledujte svůj pokrok pomocí těchto klíčových kontrolních seznamů:",
      pulse_title: "Vaše kontrola onboarding zdraví: 30denní průzkum spokojenosti",
      pulse_success_title: "Zpětná vazba odeslána!",
      pulse_success_desc: "Děkujeme vám za vyplnění. Vaše spokojenost je klíčem k našemu společnému úspěchu.",
      pulse_desc: "Jaká je vaše dosavadní zkušenost s integrací? Klikněte na hodnocení od 1 (špatné) do 5 (vynikající) a podělte se o své myšlenky o onboardingu.",
      pulse_label: "Celková spokojenost s onboardingem",
      pulse_comments_label: "Podělte se o své myšlenky",
      pulse_comments_placeholder: "Řekněte nám o nastavení systémů, sladění mezd nebo pokud potřebujete okamžitou pomoc Integration Leader...",
      pulse_submit: "Odeslat zpětnou vazbu k onboardingu",
      pulse_submit_submitting: "Odesílání zpětné vazby...",
      pulse_notify: "Dostávejte klíčové zprávy o integraci a aktualizace kalendáře schůzek prostřednictvím simulovaného e-mailu.",
      video_modal_title: "Upravit zdroj uvítacího videa",
      video_modal_type: "Typ zdroje videa",
      video_modal_url: "Adresa URL / cesta k videu",
      video_modal_help: "U lokálních videí použijte webově přístupný adresář. U YouTube vložte standardní adresu URL sledování nebo sdílený odkaz.",
      btn_cancel: "Zrušit",
      btn_save: "Uložit změny",
      submenu_academy: "🎓 Onboarding akademie",
      submenu_roadmap: "🗺️ Fázový plán",
      submenu_pulse: "📊 Průzkum spokojenosti",
      submenu_helpdesk: "💬 HR Helpdesk",
      
      alert_1_title: "📅 Integrační schůzka po fúzi",
      alert_1_message: "Připojte se k úřadu pro řízení integrace na dvoutýdenní kalibrační synchronizaci po fúzi v aplikaci MS Teams. 26. května, 14:00 SEČ.",
      alert_2_title: "🛡️ Kurz dodržování kybernetické bezpečnosti systémů TE",
      alert_2_message: "Všichni nově získaní zaměstnanci musí dokončit základní školení o kybernetické bezpečnosti a dodržování předpisů během prvních 30 dnů.",
      alert_3_title: "📣 Uvítací Town Hall ke kulturní integraci",
      alert_3_message: "Připojte se k vedení společnosti TE a místním vedoucím na společné uvítací setkání a otevřené otázky a odpovědi. 25. května, 10:00 SEČ.",

      // Sidebars/HR helpdesk card
      hr_title: "Otázky na HR?",
      hr_desc: "Přechod mezi společnostmi může přinést otázky týkající se benefitů, harmonogramů převodu mezd nebo převodů systémů. Submit your inquiry below:",
      hr_success_title: "Dotaz přijat!",
      hr_success_desc: "Váš místní Integration Leader tento požadavek přezkoumá a ozve se vám zpět do 24 hodin.",
      hr_subject_label: "Oblast tématu",
      hr_subject_benefits: "Onboarding benefitů a penzí",
      hr_subject_payroll: "Přechod mezd a daní",
      hr_subject_systems: "IT účty a bezpečnostní přístup",
      hr_subject_reporting: "Organizační struktura reportování",
      hr_subject_other: "Obecný dotaz na HR",
      hr_msg_label: "Vysvětlete svou otázku",
      hr_msg_placeholder: "Zde vysvětlete svůj dotaz ohledně sladění...",
      hr_submit: "Odeslat na Integration Leader",
      hr_submitting: "Odesílání požadavku...",
      
      // Milestones and Leaderboards
      milestones_header: "🔒 Odměny za milníky udržení",
      leaderboard_header: "🏆 Žebříček získaného týmu",
      leaderboard_connecting: "Připojování žebříčku...",
      badge_new_recruit: "Nový rekrut",
      badge_culture_champion: "Kulturní šampion",
      badge_systems_scholar: "Scholastik systémů",
      badge_synergy_scout: "Skaut synergie",
      badge_ultimate_integrator: "Nejvyšší integrátor",
      
      // Sidebar tracks
      sidebar_tracks_title: "Integrační sekce",
      sidebar_sales_title: "Integrace prodeje",
      sidebar_sales_desc: "Fúze zákaznických katalogů a prodejní kanály CRM.",
      sidebar_product_title: "Produkt a patenty",
      sidebar_product_desc: "Migrace technických výkresů a patentové databáze.",
      sidebar_finance_title: "Finance a daně",
      sidebar_finance_desc: "Firemní fiskální kalendáře a ERP pro konsolidaci daní.",
      status_pre_onboarding: "Přednástupní fáze",
      read_playbook_link: "📖 Číst sekci příručky &rarr;",
      
      // Tracks badge strings
      track_rd: "Sekce výzkumu a vývoje",
      track_sales: "Obchodní a komerční sekce",
      track_finance: "Finanční a administrativní sekce",
      track_general: "Obecná integrační sekce",
      integration: "Integrace",
      track: "Sekce",
      days_1_30: "Dny 1 až 30",
      days_31_60: "Dny 31 až 60",
      days_61_100: "Dny 61 až 100",
      
      // Academy curriculum translations
      academy_progress_title: "Matice pokroku v akademii",
      academy_completed: "Dokončeno {completed}",
      academy_total: "Celkem 9 lekcí",
      academy_m1_title: "Modul 1: Hodnoty TE a spolupráce",
      academy_m1_subtitle: "Sekce Vaše TE &bull; Získejte +20 XP za lekci",
      academy_m1_badge: "Vaše TE",
      academy_l1_1_title: "Lekce 1.1: Vítejte a základní hodnoty TE",
      academy_l1_1_desc: "Pochopte 4 základní pilíře TE: Integrita, Odpovědnost, Týmová práce a Inovace.",
      academy_l1_2_title: "Lekce 1.2: Rytmy a komunikační kanály",
      academy_l1_2_desc: "Dozvíte se o celopodnikových newsletterech, etiketě MS Teams a pravidelných IMO town hallech.",
      academy_l1_3_title: "Lekce 1.3: Hlavní body integračního town hallu",
      academy_l1_3_desc: "Sledujte klíčové klipy z town hallu s generálním ředitelem a najděte odpovědi na běžné dotazy.",
      
      academy_m2_title: "Modul 2: Systémy, přístup a shoda",
      academy_m2_subtitle: "Dimenze talentů a systémů &bull; Získejte +20 XP za lekci",
      academy_m2_badge: "Systémy",
      academy_l2_1_title: "Lekce 2.1: SSO údaje a nastavení sítě",
      academy_l2_1_desc: "Nastavte si zabezpečené přihlášení TE Single Sign-On a aktivujte standardní síťové přihlašovací údaje.",
      academy_l2_2_title: "Lekce 2.2: Přechod benefitů a registrace",
      academy_l2_2_desc: "Prozkoumejte plány migrace zdravotní péče a vyberte profily příspěvků na penzi.",
      academy_l2_3_title: "Lekce 2.3: Onboarding kybernetické bezpečnosti a dodržování předpisů",
      academy_l2_3_desc: "Dokončete základní certifikáty o shodě a pochopte protokoly na ochranu duševního vlastnictví.",

      academy_m3_title: "Modul 3: Růst a zachycení synergií",
      academy_m3_subtitle: "Hodnotová dimenze &bull; Získejte +20 XP za lekci",
      academy_m3_badge: "Synergie",
      academy_l3_1_title: "Lekce 3.1: Strategie synergie a zachycení katalogu",
      academy_l3_1_desc: "Přečtěte si o komerčních důvodech akvizice a hlavních bodech kombinovaného katalogu.",
      academy_l3_2_title: "Lekce 3.2: Přenos technologií a patenty",
      academy_l3_2_desc: "Synchronizujte postupy přihlašování patentů a přizpůsobte bezpečnostní seznamy pro společný vývoj.",
      academy_l3_3_title: "Lekce 3.3: Společné prodejní marže a prodejní kanály",
      academy_l3_3_desc: "Zmapujte regionální hranice prodeje a osvojte si postupy převodu klientů.",

      diagnostic_culture_warning: "Diagnostická prioritní akce: Skóre dimenze kultury je kritické",
      diagnostic_talent_warning: "Diagnostická prioritní akce: Skóre systémů a shody je kritické",
      diagnostic_value_warning: "Diagnostická prioritní akce: Skóre synergie a hodnoty je kritické",

      milestone_welcome_kit: "Uvítací balíček s reklamními předměty",
      milestone_welcome_kit_desc: "TE tričko, hrnek, samolepka s kachničkou TEodor.",
      milestone_certified_badge: "Certifikovaný odznak integrátora",
      milestone_certified_badge_desc: "Oficiální digitální odznak a certifikát.",
      milestone_bonus_tier: "Bonus za udržení zaměstnance - Úroveň 1",
      milestone_bonus_tier_desc: "Odemkne způsobilost pro integrační bonus po fúzi.",
      milestone_spotlight: "Prezentace v IMO Spotlight",
      milestone_spotlight_desc: "Profil vybraného zaměstnance ve standardním IMO newsletteru.",
      milestone_doom: "TEd retro brána",
      milestone_doom_desc: "Odemkněte vlastní retro 2D plošinovku TEd o integraci a povýšení.",
      badge_promotion_title: "Povýšení odznaku!",
      badge_promotion_subtitle: "Dosáhli jste hodnosti:",
      btn_awesome: "Skvělé!",

      // Static hero / calendar / sidebar headers (previously untranslated)
      hero_badge_label: "👋 Osobní prostor pro onboarding",
      hero_description: "Vaše personalizované integrační centrum pro prvních 100 dní. Dokončete svůj vzdělávací plán, prohlédněte si milníky plánu, odešlete pulse checky a spojte se přímo s podporou místního Integration Leadera.",
      stat_training_status: "Stav školení",
      stat_onboarding_health: "Stav spokojenosti",
      events_hub_title: "Centrum integračních akcí a aktivit TE",
      next_upcoming_event_label: "Nadcházející akce:",
      expand_calendar: "Rozbalit kalendář",
      selected_day_event: "AKCE VYBRANÉHO DNE",
      no_event_selected: "Kliknutím na den v kalendáři zobrazíte naplánované integrační akce, town hally nebo systémová školení.",
      upcoming_integration_events: "ČASOVÁ OSA NADCHÁZEJÍCÍCH AKCÍ",
      notification_title: "Naléhavá integrační řídicí upozornění",
      did_you_know_title: "Věděli jste?",
      next_tip: "Další fakt",

      // Hero stat values & footer
      hero_stat_training_value: "Aktivní &bull; Modul 1",
      hero_stat_pulse_value: "Synchronizováno ✅",
      footer_copyright: "&copy; 2026 <strong>TE Connectivity</strong>. Všechna práva vyhrazena. Integrační systém IMO po fúzi.",

      // Culture tab values
      culture_values_body: "TE Connectivity se řídí čtyřmi základními hodnotami: <strong>Integrita</strong>, <strong>Odpovědnost</strong>, <strong>Týmová práce</strong> a <strong>Inovace</strong>. Zavazujeme se během této integrace vytvářet prostředí založené na spolupráci.",
      culture_collab_note: "<strong>💡 Strategie spolupráce:</strong> Zúčastněte se místních town hallů a týmových synchronizací, abyste se spojili se svými novými kolegy a poznali globální obchodní kanály TE.",

      // Roles tab
      roles_profile_heading: "👤 Integrační profil zaměstnance",
      roles_full_name: "Celé jméno",
      roles_assigned_title: "Přidělený titul / role",
      roles_track_dept: "Oddělení integrační sekce",
      roles_system_email: "Systémový e-mail uživatele",
      roles_buddy_heading: "🤝 Přidělený integrační buddy",
      roles_buddy_help: "Váš integrační buddy vám pomůže se zabydlet, získat přístup k softwarovým zdrojům a zorientovat se v interních kanálech.",
      roles_buddy_contact: "💬 Kontaktujte buddyho přes Slack/Teams",

      // Communication tab (static fallback cards)
      comm_archive_title: "📣 Archiv digitálních oznámení",
      comm_archive_intro: "Oficiální oznámení, ohlášení zásad a integrační příručky odeslané na váš e-mail podle vaší profilové sekce.",
      comm_card1_title: "Vítejte v síti TE",
      comm_day_1: "Den 1",
      comm_card1_body: "Vaše přihlašovací údaje TE a pokyny pro přístup k síti byly plně nastaveny. Prostudujte si prosím přiloženou příručku pro připojení vašich zařízení ke globálnímu intranetu.",
      comm_view_attachment: "Zobrazit přílohu (PDF)",
      comm_card2_title: "Vyžadována akce: Školení o shodě",
      comm_day_15: "Den 15",
      comm_card2_body: "V rámci integrace musí všichni získaní zaměstnanci dokončit certifikaci TE Etika a shoda. Přihlaste se do portálu akademie a začněte.",
      comm_go_academy: "Přejít do akademie",
      comm_card3_title: "Pozvánka na globální town hall",
      comm_day_30: "Den 30",
      comm_card3_body: "Připojte se k výkonnému vedení na našem čtvrtletním globálním town hallu, kde přivítáme naše nově integrované týmy.",

      // Video modal source options
      video_opt_local: "Lokální videosoubor (MP4, WebM)",
      video_opt_youtube: "Vložená adresa URL nebo odkaz na video YouTube",

      // Notifications toggle
      notif_collapse: "Sbalit",
      notif_expand: "Rozbalit",

      // Calendar & events
      calendar_month: "Květen 2026",
      event_type_news: "NOVINKY",
      event_type_meeting: "SCHŮZKA",
      event_type_training: "ŠKOLENÍ",
      all_day: "Celý den",
      cal_no_event: "Pro {date} nejsou naplánovány žádné integrační akce. Klikněte na jiný zvýrazněný den!",
      cal_no_upcoming: "Na časové ose nejsou žádné nadcházející akce.",
      cal_e1_title: "1. den: Zahájení a uvítací snídaně",
      cal_e1_desc: "Uvítací snídaně v lobby, projev vedoucího pobočky a rozdání fyzických uvítacích balíčků!",
      cal_e2_title: "Registrace SSO pro IT účty",
      cal_e2_desc: "Termín pro dokončení registrace SSO a aktivaci nové firemní e-mailové schránky TE.",
      cal_e3_title: "Q&A setkání s vedoucím integrace IMO",
      cal_e3_desc: "Otevřené virtuální setkání pro dotazy k převodům systémů a přechodům mezd.",
      cal_e4_title: "Uvítací Town Hall ke kulturní integraci",
      cal_e4_desc: "Připojte se k vedení společnosti TE a místním vedoucím na společné uvítací setkání a otevřené otázky a odpovědi. 25. května, 10:00 SEČ.",
      cal_e5_title: "Integrační schůzka po fúzi",
      cal_e5_desc: "Připojte se k úřadu pro řízení integrace na dvoutýdenní kalibrační synchronizaci po fúzi v aplikaci MS Teams. 26. května, 14:00 SEČ.",
      cal_e6_title: "Kurz dodržování kybernetické bezpečnosti systémů TE",
      cal_e6_desc: "Všichni nově získaní zaměstnanci musí dokončit základní školení o kybernetické bezpečnosti a dodržování předpisů během prvních 30 dnů."
    }
  };

  // --- 3. DYNAMIC TIMELINE CHECKLIST DATA ---
  const TIMELINE_DATA = {
    rd: {
      badgeKey: "track_rd",
      steps: [
        {
          timeKey: "days_1_30",
          titleKeys: {
            en: "Orientation, Accounts, & Safety Protocols",
            de: "Einführung, Konten & Sicherheitsrelevante Protokolle",
            zh: "入职培训、账户配置与安全协议",
            cs: "Orientace, účty a bezpečnostní protokoly"
          },
          descKeys: {
            en: "Establish your core accounts and understand TE's labs security standards.",
            de: "Richten Sie Ihre Hauptkonten ein und verstehen Sie die Sicherheitsstandards der TE-Labore.",
            zh: "建立您的核心账户并了解 TE 的实验室安全标准。",
            cs: "Zřiďte si základní účty a seznamte se s bezpečnostními standardy laboratoří TE."
          },
          tasksKeys: [
            {
              en: "Log in to TE System Solutions & set up SSO",
              de: "Melden Sie sich bei den TE-Systemlösungen an und richten Sie SSO ein",
              zh: "登录 TE 系统解决方案并设置单点登录 (SSO)",
              cs: "Přihlaste se do TE System Solutions a nastavte SSO"
            },
            {
              en: "Read the TE Lab Safety Manual & sign compliance slips",
              de: "Lesen Sie das TE-Laborsicherheitshandbuch und unterschreiben Sie die Konformitätserklärungen",
              zh: "阅读 TE 实验室安全手册并签署合规单",
              cs: "Přečtěte si příručku bezpečnosti laboratoří TE a podepište prohlášení o shodě"
            },
            {
              en: "Meet with your local TE Engineering buddy and IMO coordinator",
              de: "Treffen Sie sich mit Ihrem TE-Entwicklungspartner und dem IMO-Koordinator",
              zh: "与您当地 of TE 工程伙伴和 IMO 协调员会面",
              cs: "Setkejte se se svým místním inženýrským partnerem TE a IMO koordinátorem"
            }
          ]
        },
        {
          timeKey: "days_31_60",
          titleKeys: {
            en: "Tool Alignment & Product Design Calibration",
            de: "Werkzeugabstimmung & Produktdesign-Kalibrierung",
            zh: "工具对齐与产品设计校准",
            cs: "Sladění nástrojů a kalibrace produktového designu"
          },
          descKeys: {
            en: "Synchronize software versions and learn TE part numbering guidelines.",
            de: "Synchronisieren Sie Softwareversionen und lernen Sie die Richtlinien für TE-Teilenummern.",
            zh: "同步软件版本并学习 TE 零件编号指南。",
            cs: "Synchronizujte verze softwaru a seznamte se s pokyny pro číslování dílů TE."
          },
          tasksKeys: [
            {
              en: "Complete TE Cyber Security and IP Protection training",
              de: "Schließen Sie die Schulungen zur TE-Cybersicherheit und zum Schutz des geistigen Eigentums ab",
              zh: "完成 TE 网络安全和知识产权保护培训",
              cs: "Dokončete školení kybernetické bezpečnosti a ochrany IP společnosti TE"
            },
            {
              en: "Map local product components to TE Connectivity catalogs",
              de: "Ordnen Sie lokale Produktkomponenten den TE Connectivity-Katalogen zu",
              zh: "将本地产品组件映射到 TE Connectivity 产品目录",
              cs: "Namapujte místní produktové komponenty do katalogů TE Connectivity"
            },
            {
              en: "Connect local CAD databases with TE PDM databases",
              de: "Verbinden Sie lokale CAD-Datenbanken mit den PDM-Datenbanken von TE",
              zh: "将本地 CAD 数据库与 TE PDM 数据库连接起来",
              cs: "Propojte místní CAD databáze s databázemi PDM společnosti TE"
            }
          ]
        },
        {
          timeKey: "days_61_100",
          titleKeys: {
            en: "Collaborative Innovation & Synergy Steady State",
            de: "Gemeinsame Innovation & Stabile Synergiephase",
            zh: "协同创新与持续性协同状态",
            cs: "Společné inovace a stabilní stav synergie"
          },
          descKeys: {
            en: "Launch combined design tracks and explore TE's global laboratory resources.",
            de: "Starten Sie gemeinsame Entwicklungspfade und erkunden Sie die globalen Laborressourcen von TE.",
            zh: "启动联合设计轨道，并探索 TE 的全球实验室资源。",
            cs: "Zahajte kombinované konstrukční cesty a prozkoumejte globální laboratorní zdroje společnosti TE."
          },
          tasksKeys: [
            {
              en: "Align local patent filings with TE Corporate Legal",
              de: "Stimmen Sie lokale Patentanmeldungen mit der Rechtsabteilung von TE ab",
              zh: "将本地专利申请与 TE 集团法务对接",
              cs: "Slaďte místní přihlášky patentů s právním oddělením TE"
            },
            {
              en: "Run your first combined testing suite on TE calibration equipment",
              de: "Führen Sie Ihre erste gemeinsame Testreihe auf Kalibriergeräten von TE durch",
              zh: "在 TE 校准设备上运行您的首个联合测试套件",
              cs: "Spusťte první kombinovanou testovací sadu na kalibračním zařízení TE"
            },
            {
              en: "Review career advancement pathways in global TE R&D circles",
              de: "Prüfen Sie Karrierewege innerhalb der weltweiten R&D-Bereiche von TE",
              zh: "了解 TE 全球研发部门的职业晋升通道",
              cs: "Prozkoumejte možnosti kariérního postupu v globálních kruzích R&D společnosti TE"
            }
          ]
        }
      ]
    },
    sales: {
      badgeKey: "track_sales",
      steps: [
        {
          timeKey: "days_1_30",
          titleKeys: {
            en: "Customer Connections & CRM Onboarding",
            de: "Kundenbeziehungen & CRM-Einführung",
            zh: "客户连接与 CRM 入职培训",
            cs: "Navazování kontaktů se zákazníky a CRM onboarding"
          },
          descKeys: {
            en: "Map core clients and learn to navigate TE's Salesforce environments.",
            de: "Erfassen Sie Kernkunden und lernen Sie, sich in den Salesforce-Umgebungen von TE zurechtzufinden.",
            zh: "规划核心客户并学习操作 TE 的 Salesforce 环境。",
            cs: "Zmapujte klíčové klienty a naučte se pracovat v systémech Salesforce společnosti TE."
          },
          tasksKeys: [
            {
              en: "Obtain TE CRM licenses & sign customer ethics disclosures",
              de: "Erhalten Sie TE-CRM-Lizenzen und unterschreiben Sie die Kundenspezifischen Ethikerklärungen",
              zh: "获取 TE CRM 许可并签署客户道德规范披露文件",
              cs: "Získejte licence TE CRM a podepište prohlášení o etice zákazníků"
            },
            {
              en: "Attend combined M&A commercial pipeline review town hall",
              de: "Nehmen Sie am gemeinsamen M&A-Vertriebs-Town-Hall teil",
              zh: "参加联合并购商业项目储备评审全员大会",
              cs: "Zúčastněte se společného town hallu k přezkumu obchodních příležitostí M&A"
            },
            {
              en: "Map overlapping top 20 enterprise target accounts",
              de: "Erfassen Sie überschneidende Top-20-Unternehmenskonten",
              zh: "梳理重合度最高的前 20 个大客户目标账户",
              cs: "Zmapujte překrývajících se top 20 klíčových zákaznických účtů"
            }
          ]
        },
        {
          timeKey: "days_31_60",
          titleKeys: {
            en: "Pricing Alignment & Logistics Harmonization",
            de: "Preisanpassung & Harmonisierung der Logistik",
            zh: "定价调整与物流协调",
            cs: "Sladění cenotvorby a harmonizace logistiky"
          },
          descKeys: {
            en: "Adapt pricing catalogs to standard TE levels and merge logistics paths.",
            de: "Passen Sie Preiskataloge an TE-Standardniveaus an und führen Sie Logistikwege zusammen.",
            zh: "将定价目录调整为标准的 TE 级别，并合并物流路径。",
            cs: "Přizpůsobte cenové katalogy standardním úrovním TE a slučte logistické trasy."
          },
          tasksKeys: [
            {
              en: "Complete TE Trade Compliance and Anti-Bribery training",
              de: "Schließen Sie die Schulungen zur TE-Handelskonformität und Antikorruption ab",
              zh: "完成 TE 贸易合规和反贿赂培训",
              cs: "Dokončete školení shody s pravidly obchodu a proti úplatkářství společnosti TE"
            },
            {
              en: "Map local pricing strategies to standard TE margins guidelines",
              de: "Stimmen Sie lokale Preisstrategien mit den Standard-Margenrichtlinien von TE ab",
              zh: "将本地定价策略与标准的 TE 利润率指南进行对接",
              cs: "Namapujte místní cenové strategie podle standardních pokynů pro marže TE"
            },
            {
              en: "Unify distribution channels and freight agreements",
              de: "Vereinheitlichen Sie Vertriebskanäle und Frachtvereinbarungen",
              zh: "统一分销渠道和货运协议",
              cs: "Sjednoťte distribuční kanály a přepravní smlouvy"
            }
          ]
        },
        {
          timeKey: "days_61_100",
          titleKeys: {
            en: "Joint Go-to-Market Expansion",
            de: "Gemeinsame Marktexpansion",
            zh: "联合市场拓展与扩张",
            cs: "Společná expanze na trh"
          },
          descKeys: {
            en: "Launch shared campaigns and leverage TE's massive global customer base.",
            de: "Starten Sie gemeinsame Kampagnen und nutzen Sie die enorme weltweite Kundenbasis von TE.",
            zh: "启动联合活动，利用 TE 庞大的全球客户群。",
            cs: "Zahajte společné kampaně a využijte masivní globální zákaznickou základnu společnosti TE."
          },
          tasksKeys: [
            {
              en: "Deliver joint introductory presentations to acquired clients",
              de: "Halten Sie gemeinsame Einführungspräsentationen bei übernommenen Kunden",
              zh: "向被收购客户进行联合介绍性演示",
              cs: "Představte společné prezentace získaným klientům"
            },
            {
              en: "Co-brand promotional marketing assets for new connectivity lines",
              de: "Erstellen Sie Co-Branding-Marketingmaterialien für neue Verbindungslinien",
              zh: "为新的连接线协同设计联合品牌促销营销资产",
              cs: "Vytvořte společnou značku marketingových materiálů pro nové řady konektivity"
            },
            {
              en: "Achieve first joint cross-sell order milestone!",
              de: "Erreichen Sie den ersten gemeinsamen Cross-Selling-Meilenstein!",
              zh: "达成首个联合交叉销售订单里程碑！",
              cs: "Dosáhněte prvního společného milníku v křížovém prodeji!"
            }
          ]
        }
      ]
    },
    finance: {
      badgeKey: "track_finance",
      steps: [
        {
          timeKey: "days_1_30",
          titleKeys: {
            en: "Ledger Mapping & Accounts Transition",
            de: "Kontenmapping & Kontenübertragung",
            zh: "账簿映射与账户过渡",
            cs: "Mapování účetních knih a přechod účtů"
          },
          descKeys: {
            en: "Connect systems and understand corporate reporting calendar schedules.",
            de: "Verbinden Sie die Systeme und verstehen Sie die Termine des Konzernberichtswesens.",
            zh: "连接系统并了解集团财务报告日历日程安排。",
            cs: "Propojte systémy a seznamte se s harmonogramy podnikového výkaznictví."
          },
          tasksKeys: [
            {
              en: "Set up logins for TE Connectivity financial networks",
              de: "Richten Sie Zugänge für die Finanznetzwerke von TE Connectivity ein",
              zh: "设置 TE Connectivity 财务网络的登录账户",
              cs: "Nastavte si přihlášení do finančních sítí TE Connectivity"
            },
            {
              en: "Join the chart of accounts synchronization workshops",
              de: "Nehmen Sie an den Workshops zur Harmonisierung des Kontenplans teil",
              zh: "参加会计科目表同步研讨会",
              cs: "Zúčastněte se workshopů k synchronizaci účtové osnovy"
            },
            {
              en: "Map bank account controls and audit signatures",
              de: "Erfassen Sie Bankkontokontrollen und Prüfungsunterschriften",
              zh: "梳理银行账户控制和审计签名权限",
              cs: "Zmapujte kontroly bankovních účtů a podpisové vzory pro audity"
            }
          ]
        },
        {
          timeKey: "days_31_60",
          titleKeys: {
            en: "ERP Integrations & Payroll Alignment",
            de: "ERP-Integrationen & Gehaltsanpassung",
            zh: "ERP 系统整合与薪资对接",
            cs: "Integrace ERP a sladění mezd"
          },
          descKeys: {
            en: "Harmonize billing files and transfer acquired staff into TE Payroll structures.",
            de: "Harmonisieren Sie Abrechnungsdateien und übertragen Sie übernommene Mitarbeiter in die TE-Gehaltsabrechnung.",
            zh: "协调账单文件并将被收购的员工转移至 TE 薪资架构中。",
            cs: "Harmonizujte fakturační soubory a převeďte získané zaměstnance do mzdových struktur TE."
          },
          tasksKeys: [
            {
              en: "Complete TE Sarbanes-Oxley (SOX) compliance courses",
              de: "Schließen Sie die TE-Sarbanes-Oxley (SOX) Compliance-Kurse ab",
              zh: "完成 TE 萨班斯-奥克斯利法案 (SOX) 合规课程",
              cs: "Dokončete kurzy dodržování předpisů Sarbanes-Oxley (SOX) společnosti TE"
            },
            {
              en: "Transfer general billing channels into TE System Solutions ERP",
              de: "Übertragen Sie allgemeine Abrechnungskanäle in das TE System Solutions ERP",
              zh: "将通用账单渠道转移到 TE 系统解决方案 ERP 中",
              cs: "Převeďte obecné fakturační kanály do ERP systému TE System Solutions"
            },
            {
              en: "Conduct pilot run for acquired workforce payroll conversion",
              de: "Führen Sie einen Testlauf für die Lohn- und Gehaltsabrechnung der übernommenen Belegschaft durch",
              zh: "对被收购员工的薪资转换进行试点试运行",
              cs: "Proveďte zkušební běh převodu mezd získaných zaměstnanců"
            }
          ]
        },
        {
          timeKey: "days_61_100",
          titleKeys: {
            en: "Combined Financial Close & Steady State",
            de: "Gemeinsamer Finanzabschluss & Stabile Phase",
            zh: "合并财务结算与稳定持续状态",
            cs: "Kombinovaná účetní závěrka a stabilní stav"
          },
          descKeys: {
            en: "Execute combined monthly accounts closures and transition support to TE treasury.",
            de: "Führen Sie gemeinsame monatliche Buchhaltungsabschlüsse durch und übertragen Sie die Unterstützung auf die TE-Zentralfinanz.",
            zh: "执行合并月度账户结账，并将每日资金运营交接给 TE 资金部。",
            cs: "Provádějte kombinované měsíční účetní závěrky a převeďte operace na centrální pokladnu TE."
          },
          tasksKeys: [
            {
              en: "Coordinate the first combined tax filing reconciliation",
              de: "Koordinieren Sie den ersten gemeinsamen Steuererklärungsabgleich",
              zh: "协调首次合并报税对账工作",
              cs: "Koordinujte první sloučené daňové vyrovnání"
            },
            {
              en: "Execute combined monthly fiscal close under TE audit protocols",
              de: "Führen Sie den gemeinsamen monatlichen Finanzabschluss gemäß den TE-Prüfungsprotokollen durch",
              zh: "在 TE 审计协议下执行合并月度财务结算",
              cs: "Proveďte kombinovanou měsíční účetní závěrku podle protokolů auditu TE"
            },
            {
              en: "Transition daily cash operations to centralized TE treasury desk",
              de: "Übertragen Sie den täglichen Bargeldbetrieb auf den zentralen TE-Finanzbereich",
              zh: "将日常资金业务移交至集中化的 TE 资金管理台",
              cs: "Převeďte každodenní hotovostní operace na centrální pokladnu společnosti TE"
            }
          ]
        }
      ]
    },
    general: {
      badgeKey: "track_general",
      steps: [
        {
          timeKey: "days_1_30",
          titleKeys: {
            en: "Welcome & Workspace Configurations",
            de: "Willkommen & Konfiguration des Arbeitsplatzes",
            zh: "欢迎入职与工作空间配置",
            cs: "Vítejte a nastavení pracovního prostoru"
          },
          descKeys: {
            en: "Get set up at your new TE Connectivity workspace and meet the teams.",
            de: "Richten Sie sich an Ihrem neuen TE-Arbeitsplatz ein und lernen Sie die Teams kennen.",
            zh: "在您新的 TE Connectivity 工作空间中完成配置并与团队见面。",
            cs: "Zařiďte se na svém novém pracovišti TE Connectivity a seznamte se s týmy."
          },
          tasksKeys: [
            {
              en: "Log in to your TE Email & set up profile credentials",
              de: "Melden Sie sich bei Ihrer TE-E-Mail an und richten Sie Ihre Profilzugangsdaten ein",
              zh: "登录您的 TE 电子邮箱并设置个人资料凭据",
              cs: "Přihlaste se ke svému TE e-mailu a nastavte si přihlašovací údaje k profilu"
            },
            {
              en: "Meet your team and integration coordinator during welcome lunch",
              de: "Treffen Sie Ihr Team und den Integrationskoordinator bei einem Willkommensessen",
              zh: "在欢迎午餐期间与您的团队及整合协调员见面会谈",
              cs: "Seznamte se se svým týmem a koordinátorem integrace během uvítacího oběda"
            },
            {
              en: "Connect with your local Integration Leader to review benefits calendars",
              de: "Wenden Sie sich an Ihren lokalen Integration Leader, um die Sozialleistungskalender zu besprechen",
              zh: "与当地的 Integration Leader 联系以查看福利待遇计划时间表",
              cs: "Spojte se se svým místním Integration Leader a projděte si harmonogramy benefitů"
            }
          ]
        },
        {
          timeKey: "days_31_60",
          titleKeys: {
            en: "Benefits Migration & Compliance Courses",
            de: "Leistungsübertragung & Compliance-Kurse",
            zh: "福利迁移与合规课程",
            cs: "Migrace benefitů a kurzy shody s předpisy"
          },
          descKeys: {
            en: "Complete required training and transition all benefits into TE platforms.",
            de: "Absolvieren Sie erforderliche Schulungen und übertragen Sie alle Leistungen in die TE-Plattformen.",
            zh: "完成所需的培训，并将所有福利转移到 TE 平台中。",
            cs: "Dokončete požadovaná školení a převeďte všechny benefity do platforem TE."
          },
          tasksKeys: [
            {
              en: "Complete TE Values and Cybersecurity compliance modules",
              de: "Schließen Sie die TE-Werte- und Cybersicherheits-Compliance-Module ab",
              zh: "完成 TE 价值观和网络安全合规模块",
              cs: "Dokončete moduly Hodnoty TE a shoda v oblasti kybernetické bezpečnosti"
            },
            {
              en: "Finalize enrollments in TE retirement plans and healthcare options",
              de: "Schließen Sie Ihre Anmeldungen für die TE-Altersvorsorgepläne und Krankenversicherungen ab",
              zh: "最终确定加入 TE 退休计划和医疗保健选择的方案",
              cs: "Dokončete registraci do penzijních plánů TE a možností zdravotní péče"
            },
            {
              en: "Participate in joint department alignment workshops",
              de: "Nehmen Sie an gemeinsamen Workshops zur Abteilungsausrichtung teil",
              zh: "参加部门联合对接调整研讨会",
              cs: "Zúčastněte se společných workshopů k sladění oddělení"
            }
          ]
        },
        {
          timeKey: "days_61_100",
          titleKeys: {
            en: "Steady State & Career Blueprint Planning",
            de: "Stabiler Zustand & Karriere-Blueprint-Planung",
            zh: "稳定持续状态与职业发展蓝图规划",
            cs: "Stabilní stav a plánování kariérního postupu"
          },
          descKeys: {
            en: "Align with TE Connectivity targets and map your growth opportunities.",
            de: "Stimmen sich mit den TE Connectivity-Zielen ab und planen Sie Ihre Entwicklungschancen.",
            zh: "与 TE Connectivity 的目标保持一致并规划您的成长空间与机遇。",
            cs: "Slaďte se s cíli TE Connectivity a zmapujte své příležitosti k růstu."
          },
          tasksKeys: [
            {
              en: "Establish your performance goals in the TE review portal",
              de: "Legen Sie Ihre Leistungsziele im TE-Mitarbeiterbeurteilungsportal fest",
              zh: "在 TE 考核门户中确立您的绩效目标",
              cs: "Stanovte si své výkonnostní cíle v portálu pro hodnocení TE"
            },
            {
              en: "Take your 90-day post-merger onboarding satisfaction feedback survey",
              de: "Nehmen Sie an der 90-Tage-Zufriedenheitsumfrage zum Onboarding nach dem Zusammenschluss teil",
              zh: "参加合并后第 90 天入职满意度反馈调查",
              cs: "Vyplňte 90denní průzkum spokojenosti s onboardingem po fúzi"
            },
            {
              en: "Review career advancement pathways across TE's global corporate tracks",
              de: "Prüfen Sie Aufstiegsmöglichkeiten in den weltweiten Karrierepfaden von TE",
              zh: "了解 TE 全球化企业发展路线下的职业晋升通道",
              cs: "Prozkoumejte cesty kariérního postupu v globálních firemních sekcích TE"
            }
          ]
        }
      ]
    }
  };

  // --- 4. DYNAMIC TIMELINE GENERATION & LOCALIZATION ENGINE ---

  function generateTimeline(dept, lang) {
    const timelineContainer = document.getElementById('employee-timeline-container');
    const deptBadge = document.getElementById('dept-timeline-badge');
    if (!timelineContainer) return;

    const cleanDept = dept.trim().toLowerCase();
    let trackKey = 'general';
    
    if (cleanDept.includes('r&d') || cleanDept.includes('eng') || cleanDept.includes('prod') || cleanDept.includes('tech')) {
      trackKey = 'rd';
    } else if (cleanDept.includes('sale') || cleanDept.includes('mkt') || cleanDept.includes('biz')) {
      trackKey = 'sales';
    } else if (cleanDept.includes('fin') || cleanDept.includes('audit') || cleanDept.includes('tax')) {
      trackKey = 'finance';
    }

    const trackData = TIMELINE_DATA[trackKey];
    const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;

    // Set the department badge text
    if (deptBadge) {
      deptBadge.textContent = dict[trackData.badgeKey] || dict.track_general;
    }

    let timelineHTML = "";
    trackData.steps.forEach((step, index) => {
      const isActive = index === 0 ? "active" : "";
      
      let taskListHTML = "";
      step.tasksKeys.forEach((task, tIndex) => {
        // For first task in first step, make it checked and disabled to represent orientation done
        const isChecked = (index === 0 && tIndex === 0) ? "checked disabled" : "";
        const taskText = task[lang] || task.en;
        taskListHTML += `
          <li><label><input type="checkbox" ${isChecked}> ${escapeHtml(taskText)}</label></li>
        `;
      });

      const stepTime = dict[step.timeKey] || step.timeKey;
      const stepTitle = step.titleKeys[lang] || step.titleKeys.en;
      const stepDesc = step.descKeys[lang] || step.descKeys.en;

      timelineHTML += `
        <!-- Step ${index + 1} -->
        <div class="timeline-item ${isActive}">
          <div class="timeline dot"></div>
          <div class="timeline-dot"></div>
          <div class="timeline-time">${escapeHtml(stepTime)}</div>
          <div class="timeline-title">${escapeHtml(stepTitle)}</div>
          <div class="timeline-desc">${escapeHtml(stepDesc)}</div>
          <ul class="timeline-tasks">
            ${taskListHTML}
          </ul>
        </div>
      `;
    });

    timelineContainer.innerHTML = timelineHTML;
  }

  function setLanguage(lang) {
    localStorage.setItem('employeeLanguage', lang);
    
    // Set dropdown value
    const select = document.getElementById('language-select');
    if (select) select.value = lang;

    // Reload video settings dynamically based on new language
    if (typeof loadVideoSettings === 'function') {
      loadVideoSettings();
    }

    const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;

    // 1. Static text elements with data-i18n
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (dict[key]) {
        if (key === 'video_alert_tip' || key === 'academy_m1_subtitle' || key === 'academy_m2_subtitle' || key === 'academy_m3_subtitle' || key === 'video_duration' || key === 'video_alert_body' || key === 'hero_stat_training_value' || key === 'footer_copyright' || key === 'culture_values_body' || key === 'culture_collab_note') {
          el.innerHTML = dict[key];
        } else {
          el.textContent = dict[key];
        }
      }
    });

    // Translate placeholder attributes
    const commentsTextarea = document.getElementById('pulse-comments');
    if (commentsTextarea && dict.pulse_comments_placeholder) {
      commentsTextarea.placeholder = dict.pulse_comments_placeholder;
    }

    const hrMsgTextarea = document.getElementById('hr-inquiry-msg');
    if (hrMsgTextarea && dict.hr_msg_placeholder) {
      hrMsgTextarea.placeholder = dict.hr_msg_placeholder;
    }

    // 2. Welcome card headers translations
    const welcomeNameEl = document.getElementById('employee-welcome-name');
    if (welcomeNameEl && dict.welcome_personal) {
      welcomeNameEl.textContent = dict.welcome_personal.replace('{name}', name);
    }

    const welcomeSubtitleEl = document.getElementById('employee-welcome-subtitle');
    if (welcomeSubtitleEl && dict.welcome_subtitle) {
      let trackKey = 'general';
      const cleanDept = dept.trim().toLowerCase();
      if (cleanDept.includes('r&d') || cleanDept.includes('eng') || cleanDept.includes('prod') || cleanDept.includes('tech')) {
        trackKey = 'rd';
      } else if (cleanDept.includes('sale') || cleanDept.includes('mkt') || cleanDept.includes('biz')) {
        trackKey = 'sales';
      } else if (cleanDept.includes('fin') || cleanDept.includes('audit') || cleanDept.includes('tax')) {
        trackKey = 'finance';
      }
      const trackData = TIMELINE_DATA[trackKey];
      const transDept = dict[trackData.badgeKey] || dict.track_general;
      
      welcomeSubtitleEl.textContent = dict.welcome_subtitle
        .replace('{role}', role)
        .replace('{dept}', transDept)
        .replace('{company}', company);
    }

    // 3. Dynamic timeline checklists
    generateTimeline(dept, lang);

    // Department integration tracks (re-render so labels follow the language)
    renderEmployeeDeptTracks();

    // 4. Academy Tab programmatic translations
    // Translate Module 1
    const m1Header = document.querySelector('#module-culture-card .card-header h3');
    if (m1Header) m1Header.textContent = dict.academy_m1_title;
    const m1Sub = document.querySelector('#module-culture-card .card-header span');
    if (m1Sub) m1Sub.innerHTML = dict.academy_m1_subtitle;
    const m1Badge = document.querySelector('#module-culture-card .card-header .hero-badge');
    if (m1Badge) m1Badge.textContent = dict.academy_m1_badge;

    // Translate Module 2
    const m2Header = document.querySelector('#module-talent-card .card-header h3');
    if (m2Header) m2Header.textContent = dict.academy_m2_title;
    const m2Sub = document.querySelector('#module-talent-card .card-header span');
    if (m2Sub) m2Sub.innerHTML = dict.academy_m2_subtitle;
    const m2Badge = document.querySelector('#module-talent-card .card-header .hero-badge');
    if (m2Badge) m2Badge.textContent = dict.academy_m2_badge;

    // Translate Module 3
    const m3Header = document.querySelector('#module-value-card .card-header h3');
    if (m3Header) m3Header.textContent = dict.academy_m3_title;
    const m3Sub = document.querySelector('#module-value-card .card-header span');
    if (m3Sub) m3Sub.innerHTML = dict.academy_m3_subtitle;
    const m3Badge = document.querySelector('#module-value-card .card-header .hero-badge');
    if (m3Badge) m3Badge.textContent = dict.academy_m3_badge;

    // Module Priority Banners (Diagnostic warnings)
    const bannerCulture = document.getElementById('banner-culture-priority');
    if (bannerCulture) bannerCulture.innerHTML = `⚠️ ` + dict.diagnostic_culture_warning;
    const bannerTalent = document.getElementById('banner-talent-priority');
    if (bannerTalent) bannerTalent.innerHTML = `⚠️ ` + dict.diagnostic_talent_warning;
    const bannerValue = document.getElementById('banner-value-priority');
    if (bannerValue) bannerValue.innerHTML = `⚠️ ` + dict.diagnostic_value_warning;

    // Academy progress card metrics
    const progressTitle = document.querySelector('.academy-progress-card span');
    if (progressTitle) progressTitle.textContent = dict.academy_progress_title;
    const completedCount = activeEmployee ? (activeEmployee.completedLessons ? activeEmployee.completedLessons.length : 0) : 0;
    const progressCompleted = document.getElementById('academy-completed-text');
    if (progressCompleted) progressCompleted.textContent = dict.academy_completed.replace('{completed}', completedCount.toString());
    const progressTotalText = progressCompleted ? progressCompleted.nextElementSibling : null;
    if (progressTotalText) progressTotalText.textContent = dict.academy_total;

    // Curriculum lessons now render from the Course CMS API (Phase 3B) in the active language
    if (typeof renderAcademyFromApi === 'function') renderAcademyFromApi();

    // 5. Sidebar HR elements translations
    // (The "Integration Tracks" heading is tagged with data-i18n="sidebar_tracks_title"
    //  and the department cards are rendered/localized by renderEmployeeDeptTracks(),
    //  so the old .placeholder-card / .placeholder-badge selectors were removed.)

    // HR helpdesk dropdown options
    const hrSubjectSelect = document.getElementById('hr-inquiry-subject');
    if (hrSubjectSelect) {
      const labelSub = hrSubjectSelect.previousElementSibling;
      if (labelSub) labelSub.textContent = dict.hr_subject_label;

      const optBenefits = hrSubjectSelect.querySelector('option[value="benefits"]');
      if (optBenefits) optBenefits.textContent = dict.hr_subject_benefits;
      const optPayroll = hrSubjectSelect.querySelector('option[value="payroll"]');
      if (optPayroll) optPayroll.textContent = dict.hr_subject_payroll;
      const optSystems = hrSubjectSelect.querySelector('option[value="systems"]');
      if (optSystems) optSystems.textContent = dict.hr_subject_systems;
      const optReporting = hrSubjectSelect.querySelector('option[value="reporting"]');
      if (optReporting) optReporting.textContent = dict.hr_subject_reporting;
      const optOther = hrSubjectSelect.querySelector('option[value="other"]');
      if (optOther) optOther.textContent = dict.hr_subject_other;
    }

    const hrFormTitle = document.querySelector('.hr-help-card h3');
    if (hrFormTitle) hrFormTitle.textContent = dict.hr_title;
    const hrFormDesc = document.querySelector('.hr-help-card p');
    if (hrFormDesc && !hrFormDesc.classList.contains('hr-success')) hrFormDesc.textContent = dict.hr_desc;

    const hrSuccessBox = document.getElementById('hr-form-success-message');
    if (hrSuccessBox) {
      const succTitle = hrSuccessBox.querySelector('h4');
      if (succTitle) succTitle.textContent = dict.hr_success_title;
      const succDesc = hrSuccessBox.querySelector('p');
      if (succDesc) succDesc.textContent = dict.hr_success_desc;
    }

    const hrQuestionLabel = document.querySelector('label[for="hr-inquiry-msg"]');
    if (hrQuestionLabel) hrQuestionLabel.textContent = dict.hr_msg_label;

    const hrSubmitBtn = document.querySelector('#hr-inquiry-form button[type="submit"]');
    // Pulse survey card submit button
    const pulseSubmitBtn = document.getElementById('btn-submit-pulse');
    if (pulseSubmitBtn && !pulseSubmitBtn.disabled && pulseSubmitBtn.textContent.trim() !== "Submitting Feedback...") {
      pulseSubmitBtn.textContent = dict.pulse_submit;
    }

    const pulseNotifyLabel = document.querySelector('label[for="pulse-notify-pref"]');
    if (pulseNotifyLabel) pulseNotifyLabel.textContent = dict.pulse_notify;

    // Headers on Leaderboard and Milestones
    const milestoneCont = document.getElementById('academy-milestones-container');
    if (milestoneCont) {
      const headerH3 = milestoneCont.previousElementSibling.querySelector('h3');
      if (headerH3) headerH3.textContent = dict.milestones_header;
    }

    const leaderboardCont = document.getElementById('academy-leaderboard-container');
    if (leaderboardCont) {
      const headerH3 = leaderboardCont.previousElementSibling.querySelector('h3');
      if (headerH3) headerH3.textContent = dict.leaderboard_header;
    }

    // 6. Dynamic update of active employee milestones and profiles
    if (activeEmployee) {
      renderProfileCard(activeEmployee);
      updateMilestones(activeEmployee.points || 0);
    }

    // 7. Dynamic reload of localized alerts
    loadEmployeeAlerts();

    // 8. Re-localize the events calendar (month title, weekday headers, event copy)
    if (typeof renderEventsCalendar === 'function') renderEventsCalendar();

    // 9. Re-render the rotating "Did You Know?" fact in the new language
    if (window.__renderDidYouKnowFact) window.__renderDidYouKnowFact();

    // 10. Notifications collapse/expand toggle label follows current state
    const notifToggleText = document.getElementById('notifications-toggle-text');
    const notifList = document.getElementById('employee-notifications-list');
    if (notifToggleText) {
      notifToggleText.textContent = (notifList && notifList.style.display === 'none')
        ? dict.notif_expand : dict.notif_collapse;
    }
  }

  // --- 5. WELCOME VIDEO SOURCE AND PLAYER IMPLEMENTATION ---

  function getYoutubeId(url) {
    if (!url) return null;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  }

  function updateVideoUI() {
    const url = activeVideoSettings.welcomeVideoUrl;
    const type = activeVideoSettings.welcomeVideoType;
    const currentLang = localStorage.getItem('employeeLanguage') || 'en';
    
    const videoWrapper = document.querySelector('.video-wrapper');
    const overlayCtrls = document.getElementById('welcome-video-overlay-ctrls');
    const placeholderBg = document.getElementById('welcome-video-placeholder-bg');
    const playerContainer = document.getElementById('welcome-video-player-container');
    const playBtn = document.getElementById('btn-play-video');
    
    // Remove any existing dynamic CTA button
    const oldCta = document.getElementById('btn-add-video-cta');
    if (oldCta) oldCta.remove();
    
    if (!url) {
      // If no video URL, display a beautiful localized CTA button
      const ctaBtn = document.createElement('button');
      ctaBtn.id = 'btn-add-video-cta';
      ctaBtn.className = 'btn btn-primary';
      
      let ctaText = "🎬 Welcome video coming soon";
      if (currentLang === 'de') ctaText = "🎬 Begrüßungsvideo folgt in Kürze";
      if (currentLang === 'zh') ctaText = "🎬 欢迎视频即将推出";
      if (currentLang === 'cs') ctaText = "🎬 Uvítací video již brzy";

      ctaBtn.innerHTML = ctaText;
      // Phase 4: video is admin-managed per language — passive placeholder, not an editing control.
      ctaBtn.disabled = true;
      ctaBtn.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 100; font-weight: 700; padding: 0.75rem 1.5rem; font-size: 0.95rem; border-radius: var(--radius-full); border: none; background: rgba(255,255,255,0.15); color: white; cursor: default; backdrop-filter: blur(4px);';

      if (videoWrapper) videoWrapper.appendChild(ctaBtn);
      
      // Hide standard play button & text
      if (playBtn) playBtn.style.display = 'none';
      if (overlayCtrls) {
        const vTitle = overlayCtrls.querySelector('.video-title');
        const vDur = overlayCtrls.querySelector('.video-duration');
        if (vTitle) vTitle.style.display = 'none';
        if (vDur) vDur.style.display = 'none';
      }
    } else {
      // Restore standard elements
      if (playBtn) playBtn.style.display = 'flex';
      if (overlayCtrls) {
        const vTitle = overlayCtrls.querySelector('.video-title');
        const vDur = overlayCtrls.querySelector('.video-duration');
        if (vTitle) vTitle.style.display = 'block';
        if (vDur) vDur.style.display = 'block';
      }
      
      // YouTube thumbnail check
      if (type === 'youtube') {
        let youtubeId = getYoutubeId(url);
        if (!youtubeId && url.length === 11) youtubeId = url;
        
        if (youtubeId && videoWrapper) {
          const imgUrl = `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`;
          if (placeholderBg) placeholderBg.style.display = 'none';
          
          videoWrapper.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url('${imgUrl}')`;
          videoWrapper.style.backgroundSize = 'cover';
          videoWrapper.style.backgroundPosition = 'center';
        }
      } else {
        // Restore SVG and clear backgroundImage
        if (placeholderBg) placeholderBg.style.display = 'block';
        if (videoWrapper) {
          videoWrapper.style.backgroundImage = '';
        }
      }
    }
  }

  function resetVideoPlayer() {
    const playerContainer = document.getElementById('welcome-video-player-container');
    const placeholderBg = document.getElementById('welcome-video-placeholder-bg');
    const overlayCtrls = document.getElementById('welcome-video-overlay-ctrls');
    
    if (playerContainer) {
      playerContainer.innerHTML = '';
      playerContainer.style.display = 'none';
    }
    if (placeholderBg) placeholderBg.style.display = 'block';
    if (overlayCtrls) overlayCtrls.style.display = 'flex';
    
    updateVideoUI();
  }

  function loadVideoSettings() {
    fetch('/api/settings')
      .then(res => res.json())
      .then(settings => {
        const currentLang = localStorage.getItem('employeeLanguage') || 'en';
        activeVideoSettings.welcomeVideoUrl = settings[`welcomeVideoUrl_${currentLang}`] || settings.welcomeVideoUrl || "";
        activeVideoSettings.welcomeVideoType = settings[`welcomeVideoType_${currentLang}`] || settings.welcomeVideoType || "local";
        resetVideoPlayer();
      })
      .catch(err => console.error("Error loading welcome video settings:", err));
  }

  const btnPlay = document.getElementById('btn-play-video');
  const videoAlert = document.getElementById('video-alert-box');

  if (btnPlay) {
    btnPlay.addEventListener('click', (e) => {
      e.stopPropagation();
      
      const url = activeVideoSettings.welcomeVideoUrl;
      const type = activeVideoSettings.welcomeVideoType;
      
      const playerContainer = document.getElementById('welcome-video-player-container');
      const placeholderBg = document.getElementById('welcome-video-placeholder-bg');
      const overlayCtrls = document.getElementById('welcome-video-overlay-ctrls');
      
      if (!url) {
        // Fall back to original simulated alert box popup
        if (videoAlert) {
          if (videoAlert.style.display === 'block') {
            videoAlert.style.display = 'none';
            btnPlay.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>`;
          } else {
            videoAlert.style.display = 'block';
            btnPlay.innerHTML = `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>`;
          }
        }
        return;
      }
      
      // If we have a custom URL, hide simulated alert if open
      if (videoAlert) videoAlert.style.display = 'none';
      
      if (type === 'youtube') {
        let youtubeId = getYoutubeId(url);
        if (!youtubeId && url.length === 11) youtubeId = url;
        
        if (youtubeId) {
          if (placeholderBg) placeholderBg.style.display = 'none';
          if (overlayCtrls) overlayCtrls.style.display = 'none';
          
          playerContainer.style.display = 'block';
          playerContainer.innerHTML = `
            <iframe src="https://www.youtube.com/embed/${youtubeId}?autoplay=1" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen style="width: 100%; height: 100%; border-radius: var(--radius-lg); border: none;"></iframe>
            <button class="close-video-player-btn" style="position: absolute; top: 0.75rem; left: 0.75rem; z-index: 105; background: rgba(0,0,0,0.65); backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.25); color: white; border-radius: 20px; padding: 0.25rem 0.75rem; font-size: 0.75rem; cursor: pointer; display: flex; align-items: center; gap: 0.25rem; box-shadow: 0 4px 10px rgba(0,0,0,0.3); font-weight: 600; font-family: var(--font-family-sans); transition: all 0.2s;"><span style="font-size: 0.85rem; font-weight: bold;">&times;</span> Close Player</button>
          `;
          
          playerContainer.querySelector('.close-video-player-btn').addEventListener('click', (ev) => {
            ev.stopPropagation();
            resetVideoPlayer();
          });
        } else {
          alert("Invalid YouTube URL or ID entered by admin. Falling back to default welcome text.");
          activeVideoSettings.welcomeVideoUrl = ""; // trigger alert box next time
          btnPlay.click();
        }
      } else {
        // Local MP4 or WebM video file
        if (placeholderBg) placeholderBg.style.display = 'none';
        if (overlayCtrls) overlayCtrls.style.display = 'none';
        
        playerContainer.style.display = 'block';
        playerContainer.innerHTML = `
          <video src="${url}" controls autoplay style="width: 100%; height: 100%; border-radius: var(--radius-lg); object-fit: cover; background: black;"></video>
          <button class="close-video-player-btn" style="position: absolute; top: 0.75rem; left: 0.75rem; z-index: 105; background: rgba(0,0,0,0.65); backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.25); color: white; border-radius: 20px; padding: 0.25rem 0.75rem; font-size: 0.75rem; cursor: pointer; display: flex; align-items: center; gap: 0.25rem; box-shadow: 0 4px 10px rgba(0,0,0,0.3); font-weight: 600; font-family: var(--font-family-sans); transition: all 0.2s;"><span style="font-size: 0.85rem; font-weight: bold;">&times;</span> Close Player</button>
        `;
        
        playerContainer.querySelector('.close-video-player-btn').addEventListener('click', (ev) => {
          ev.stopPropagation();
          resetVideoPlayer();
        });
      }
    });
  }

  // --- 6. IN-LINE CUSTOMIZER PEN AND DIALOG EVENT BINDING ---

  const editVideoPen = document.getElementById('edit-welcome-video-pen');
  const videoModal = document.getElementById('video-edit-modal');
  const btnCloseModal = document.getElementById('btn-close-video-modal');
  const btnCancelModal = document.getElementById('btn-cancel-video-modal');
  const videoEditForm = document.getElementById('welcome-video-edit-form');
  const videoModalType = document.getElementById('video-modal-type');
  const videoModalUrl = document.getElementById('video-modal-url');

  // Phase 4: the welcome video is set from the Admin backend (per language) only.
  if (editVideoPen) editVideoPen.style.display = 'none';

  if (false && editVideoPen && videoModal) {
    editVideoPen.addEventListener('click', (e) => {
      e.stopPropagation();
      videoModalType.value = activeVideoSettings.welcomeVideoType || 'local';
      videoModalUrl.value = activeVideoSettings.welcomeVideoUrl || '';
      videoModal.classList.add('open');
    });
  }

  function closeModal() {
    if (videoModal) videoModal.classList.remove('open');
  }

  if (btnCloseModal) btnCloseModal.addEventListener('click', closeModal);
  if (btnCancelModal) btnCancelModal.addEventListener('click', closeModal);

  window.addEventListener('click', (e) => {
    if (e.target === videoModal) {
      closeModal();
    }
  });

  if (videoEditForm) {
    videoEditForm.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const type = videoModalType.value;
      const url = videoModalUrl.value.trim();
      
      const submitBtn = videoEditForm.querySelector('button[type="submit"]');
      const originalText = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = "Saving...";

      const currentLang = localStorage.getItem('employeeLanguage') || 'en';
      
      // Update payload to use localized keys
      const payload = {};
      payload[`welcomeVideoType_${currentLang}`] = type;
      payload[`welcomeVideoUrl_${currentLang}`] = url;
      // Also write fallback
      payload.welcomeVideoType = type;
      payload.welcomeVideoUrl = url;

      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(res => res.json())
        .then(data => {
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
          if (data.success) {
            activeVideoSettings.welcomeVideoType = type;
            activeVideoSettings.welcomeVideoUrl = url;
            closeModal();
            triggerConfetti();
            resetVideoPlayer();
            updateVideoUI();
          } else {
            alert("Failed to save settings: " + data.error);
          }
        })
        .catch(err => {
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
          console.error("Error saving video settings:", err);
          alert("Error saving video settings to server.");
        });
    });
  }

  // --- 7. INTERACTIVE SURVEY AND FORM CONTROLLERS ---

  // Interactive HR Inquiry Helpdesk Submission
  const hrForm = document.getElementById('hr-inquiry-form');
  const hrSuccess = document.getElementById('hr-form-success-message');

  if (hrForm && hrSuccess) {
    hrForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const submitBtn = hrForm.querySelector('button[type="submit"]');
      const lang = localStorage.getItem('employeeLanguage') || 'en';
      const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;

      submitBtn.disabled = true;
      submitBtn.textContent = dict.hr_submitting || "Submitting Ticket...";

      // File the ticket into the real communications ledger so it shows up
      // in the Integration Leader dashboard & Admin broadcast centers.
      const topicSelect = document.getElementById('hr-inquiry-subject');
      const topicLabel = topicSelect && topicSelect.selectedOptions[0] ? topicSelect.selectedOptions[0].textContent.trim() : 'General HR Inquiry';
      const message = (document.getElementById('hr-inquiry-msg') || {}).value || '';

      fetch('/api/communications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: name,
          senderRole: 'employee',
          recipientType: 'hrbp',
          recipientId: 'hrbp',
          recipientName: 'Integration Leader Helpdesk',
          recipientEmail: 'integration-leaders@te.com',
          subject: `[HR Ticket] ${topicLabel}`,
          template: 'custom',
          body: message
        })
      })
        .catch(err => console.error('Error filing HR helpdesk ticket:', err))
        .finally(() => {
          hrForm.style.display = 'none';
          hrSuccess.style.display = 'block';
        });
    });
  }

  // Interactive 30-Day Onboarding Pulse Rating Selection
  const pulseRateBtns = document.querySelectorAll('.pulse-rating-btn');
  const pulseRatingValue = document.getElementById('pulse-rating-value');
  const btnSubmitPulse = document.getElementById('btn-submit-pulse');
  const pulseForm = document.getElementById('pulse-survey-form');
  const pulseSuccess = document.getElementById('pulse-success-message');

  if (pulseRateBtns.length > 0 && pulseRatingValue && btnSubmitPulse) {
    pulseRateBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        pulseRateBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const rating = btn.getAttribute('data-rating');
        pulseRatingValue.value = rating;
        btnSubmitPulse.disabled = false;
      });
    });
  }

  // POST 30-Day Onboarding Pulse Survey Submission
  if (pulseForm && btnSubmitPulse) {
    pulseForm.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const rating = parseInt(pulseRatingValue.value);
      const comment = document.getElementById('pulse-comments').value.trim();
      const lang = localStorage.getItem('employeeLanguage') || 'en';
      const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
      
      btnSubmitPulse.disabled = true;
      btnSubmitPulse.textContent = dict.pulse_submit_submitting || "Submitting Feedback...";

      fetch('/api/pulses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeName: name,
          rating: rating,
          comment: comment,
          type: '30-day'
        })
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            pulseForm.style.display = 'none';
            pulseSuccess.style.display = 'block';
          } else {
            alert("Failed to submit feedback: " + data.error);
            btnSubmitPulse.disabled = false;
            btnSubmitPulse.textContent = dict.pulse_submit || "Submit Onboarding Feedback";
          }
        })
        .catch(err => {
          console.error("Pulse submit error:", err);
          alert("Error sending feedback to server.");
          btnSubmitPulse.disabled = false;
          btnSubmitPulse.textContent = dict.pulse_submit || "Submit Onboarding Feedback";
        });
    });
  }

  // --- 8. ANNOUNCEMENT CENTER ALERTS ---

  function loadEmployeeAlerts() {
    return; // Dynamic alerts fully disabled
    const alertCenter = document.getElementById('announcement-center');
    if (!alertCenter) return;

    // Get current language
    const currentLang = localStorage.getItem('employeeLanguage') || 'en';
    const dict = TRANSLATIONS[currentLang] || TRANSLATIONS.en;

    fetch('/api/alerts')
      .then(res => res.json())
      .then(alerts => {
        alertCenter.innerHTML = '';
        if (!alerts || alerts.length === 0) {
          alertCenter.style.display = 'none';
          return;
        }

        alertCenter.style.display = 'block';
        alerts.forEach(a => {
          const banner = document.createElement('div');
          banner.className = `announcement-banner ${a.type || 'news'}`;
          
          // Use translated title and message if available
          const title = dict[`${a.id}_title`] || a.title;
          const message = dict[`${a.id}_message`] || a.message;

          banner.innerHTML = `
            <div class="announcement-icon-pulsing">
              ${a.type === 'meeting' ? '📅' : a.type === 'training' ? '🛡️' : '📣'}
            </div>
            <div class="announcement-content-box">
              <div class="announcement-title">${escapeHtml(title)}</div>
              <div class="announcement-desc">${escapeHtml(message)}</div>
            </div>
            <button class="announcement-close-btn" title="Dismiss Alert">&times;</button>
          `;

          banner.querySelector('.announcement-close-btn').addEventListener('click', () => {
            banner.style.opacity = '0';
            banner.style.transform = 'translateY(-10px)';
            setTimeout(() => {
              banner.remove();
              if (alertCenter.children.length === 0) {
                alertCenter.style.display = 'none';
              }
            }, 300);
          });

          alertCenter.appendChild(banner);
        });
      })
      .catch(err => console.error("Error loading employee alerts:", err));
  }

  // --- 9. GAMIFICATION AND MEMBERSHIP site logic ---

  // Tab switching inside employee portal
  const tabBtns = document.querySelectorAll('.portal-tab-btn');
  const tabPanels = document.querySelectorAll('.portal-tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => {
        b.classList.remove('active');
        b.style.color = 'var(--text-dim)';
        b.style.borderBottom = '3px solid transparent';
      });
      tabPanels.forEach(p => {
        p.style.display = 'none';
        p.classList.remove('active');
      });

      btn.classList.add('active');
      btn.style.color = 'var(--te-dark-teal)';
      btn.style.borderBottom = '3px solid var(--te-orange)';

      const paneId = `portal-tab-content-${btn.getAttribute('data-portal-tab')}`;
      const pane = document.getElementById(paneId);
      if (pane) {
        pane.style.display = 'block';
        pane.classList.add('active');
      }
    });
  });

  // Query or register user profile on load
  // ---- Academy rendered from the Course CMS API (Phase 3B) ----
  let academyCourses = null;
  const cmsEsc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cmsLabel = (v, lang) => { if (v && typeof v === 'object') return v[lang] || v.en || Object.values(v).find(Boolean) || ''; return v || ''; };

  function renderAcademyFromApi() {
    const container = document.getElementById('academy-modules-container');
    if (!container || !academyCourses) return;
    const lang = localStorage.getItem('employeeLanguage') || 'en';
    const dict = (typeof TRANSLATIONS !== 'undefined' && TRANSLATIONS[lang]) ? TRANSLATIONS[lang] : {};
    const readLink = dict.read_playbook_link || '📖 Read Playbook Section →';
    const badgeMap = { culture: 'Culture', talent: 'Systems', value: 'Synergy' };
    const doneSet = new Set((activeEmployee && activeEmployee.completedLessons) || []);
    let html = '';
    academyCourses.forEach(course => {
      if (course.published === false) return;
      const gatingHard = course.gating === 'hard';
      (course.modules || []).forEach(m => {
        const lessons = (m.lessons || []).map(l => {
          const qn = (l.quiz && l.quiz.questions ? l.quiz.questions.length : 0);
          const quizBtn = `<button type="button" class="academy-view-lesson" data-lesson="${cmsEsc(l.id)}" style="font-size:0.75rem;color:var(--te-dark-teal);font-weight:600;background:none;border:none;cursor:pointer;padding:0;">📖 View lesson${qn ? ' &amp; quiz' : ''} &rarr;</button>`;
          const pb = l.playbookLink ? `<a href="${cmsEsc(l.playbookLink)}" target="_blank" class="playbook-anchor-link" style="font-size:0.75rem;color:var(--te-orange);font-weight:600;text-decoration:none;">${readLink}</a>` : '';
          // Enforce CMS "hard" course gating: a lesson whose prerequisite isn't done stays locked.
          const prereqOk = !(gatingHard && l.prerequisite && !doneSet.has(l.prerequisite));
          const lockNote = prereqOk ? '' : `<span style="font-size:0.75rem;color:var(--te-orange);font-weight:700;">🔒 Complete the prerequisite lesson to unlock</span>`;
          return `<li class="academy-lesson-item" style="display:flex;align-items:flex-start;gap:0.75rem;${prereqOk ? '' : 'opacity:0.6;'}">
            <input type="checkbox" id="lesson_${cmsEsc(l.id)}" class="academy-lesson-checkbox" data-lesson-id="${cmsEsc(l.id)}" ${prereqOk ? '' : 'disabled'} style="margin-top:0.25rem;accent-color:var(--te-orange);width:18px;height:18px;cursor:${prereqOk ? 'pointer' : 'not-allowed'};">
            <div style="flex-grow:1;">
              <label for="lesson_${cmsEsc(l.id)}" style="font-weight:600;color:var(--text-main);font-size:0.95rem;cursor:${prereqOk ? 'pointer' : 'not-allowed'};">${cmsEsc(cmsLabel(l.title, lang))}</label>
              <p style="margin:0.15rem 0 0.4rem;font-size:0.8rem;color:var(--text-secondary);line-height:1.4;">${cmsEsc(cmsLabel(l.description, lang))}</p>
              <div style="display:flex;align-items:center;gap:0.9rem;flex-wrap:wrap;">${pb}${quizBtn}${lockNote}</div>
            </div></li>`;
        }).join('');
        const badgeTxt = badgeMap[m.dimension] || cmsLabel(m.badge, lang);
        html += `<div class="card academy-module-card" style="padding-top:1.5rem;position:relative;overflow:hidden;border-left:4px solid var(--te-dark-teal);">
          <div class="card-header" style="border-bottom:1px solid var(--border-color);padding-bottom:0.75rem;margin-bottom:1rem;display:flex;justify-content:space-between;align-items:center;">
            <div><h3 style="margin:0;color:var(--te-dark-teal);font-size:1.15rem;">${cmsEsc(cmsLabel(m.title, lang))}</h3>
            <span style="font-size:0.75rem;color:var(--text-dim);">${cmsEsc(cmsLabel(m.subtitle, lang))}</span></div>
            <span class="hero-badge" style="background:rgba(36,76,90,0.08);color:var(--te-dark-teal);border:1px solid rgba(36,76,90,0.15);padding:0.2rem 0.5rem;border-radius:4px;font-size:0.75rem;">${cmsEsc(badgeTxt)}</span>
          </div>
          <ul class="academy-lessons-list" style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:1.25rem;">${lessons}</ul>
        </div>`;
      });
    });
    container.innerHTML = html || '<p style="text-align:center;color:var(--text-dim);padding:2rem;">No published courses yet.</p>';
    if (activeEmployee) syncAcademyCheckboxes(activeEmployee);
    container.querySelectorAll('.academy-view-lesson').forEach(btn => btn.addEventListener('click', () => openLessonModal(btn.getAttribute('data-lesson'))));
  }

  function loadAcademyCourses() {
    fetch('/api/courses').then(r => r.json()).then(list => { academyCourses = list || []; renderAcademyFromApi(); })
      .catch(err => console.error('Error loading academy courses:', err));
  }

  function findLesson(id) {
    for (const c of (academyCourses || [])) for (const m of (c.modules || [])) for (const l of (m.lessons || [])) if (l.id === id) return l;
    return null;
  }

  function openLessonModal(lessonId) {
    const l = findLesson(lessonId);
    if (!l) return;
    const lang = localStorage.getItem('employeeLanguage') || 'en';
    const overlay = document.createElement('div');
    overlay.className = 'cms-modal-overlay';
    const quiz = (l.quiz && l.quiz.questions && l.quiz.questions.length) ? l.quiz : null;
    const quizHtml = quiz ? `<div class="lesson-quiz"><h4 style="margin:1rem 0 0.5rem;color:var(--te-dark-teal);">Knowledge check</h4>${quiz.questions.map((q, qi) => `
      <div class="lq-q" style="margin-bottom:0.75rem;"><p style="font-weight:600;margin:0 0 0.35rem;">${qi + 1}. ${cmsEsc(cmsLabel(q.question, lang))}</p>
      ${(q.options || []).map((o, oi) => `<label style="display:block;font-size:0.9rem;margin:0.15rem 0;cursor:pointer;"><input type="radio" name="lq-${qi}" value="${oi}"> ${cmsEsc(cmsLabel(o, lang))}</label>`).join('')}</div>`).join('')}
      <button type="button" class="btn btn-primary lq-submit" style="width:auto;margin:0.5rem 0 0;">Submit answers</button>
      <p class="lq-result" style="margin-top:0.5rem;font-weight:700;"></p></div>` : '';
    overlay.innerHTML = `<div class="cms-modal"><div class="cms-modal-head"><h3>${cmsEsc(cmsLabel(l.title, lang))}</h3><button type="button" class="cms-modal-x">✕</button></div>
      <div class="cms-modal-body"><div class="lesson-body">${cmsLabel(l.body, lang) || '<p>' + cmsEsc(cmsLabel(l.description, lang)) + '</p>'}</div>${quizHtml}</div></div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('.cms-modal-x').addEventListener('click', close);
    if (quiz) {
      overlay.querySelector('.lq-submit').addEventListener('click', () => {
        let correct = 0;
        quiz.questions.forEach((q, qi) => { const sel = overlay.querySelector(`input[name="lq-${qi}"]:checked`); if (sel && parseInt(sel.value, 10) === q.correctIndex) correct++; });
        const pct = Math.round((correct / quiz.questions.length) * 100);
        const passed = pct >= (quiz.passMark || 70);
        const res = overlay.querySelector('.lq-result');
        res.textContent = `${pct}% — ${passed ? 'Passed! Lesson marked complete.' : 'Keep going and try again.'}`;
        res.style.color = passed ? '#0E9E6E' : '#B91C1C';
        if (passed) {
          const chk = document.getElementById('lesson_' + l.id);
          if (chk && !chk.checked) { chk.checked = true; chk.dispatchEvent(new Event('change', { bubbles: true })); }
          setTimeout(close, 1300);
        }
      });
    }
  }

  function initializeEmployee() {
    const url = `/api/employees/get-or-create?empId=${encodeURIComponent(empId)}&name=${encodeURIComponent(name)}&role=${encodeURIComponent(role)}&department=${encodeURIComponent(dept)}&company=${encodeURIComponent(company)}`;
    
    fetch(url)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          activeEmployee = data.employee;
          
          // Re-translate all metrics, badges, and milestones
          const lang = localStorage.getItem('employeeLanguage') || 'en';
          setLanguage(lang);
          
          renderProfileCard(activeEmployee);
          syncAcademyCheckboxes(activeEmployee);
          loadAcademyCourses();
          updateMilestones(activeEmployee.points || 0);
          loadLeaderboard(activeEmployee.id);
          fetchDiagnosticsPriority();
          loadEmployeeNotifications(activeEmployee);
        }
      })
      .catch(err => console.error("Error loading employee profile:", err));
  }

  // ===== Employee-facing Department Integration Tracks (read-only) =====
  // Renders the live department modules (from /api/departments) so employees can
  // explore each department's shared culture/comms + its systems & trainings.
  // The employee's own department (from the ?dept= param) is highlighted.
  const DEPT_TRACK_LABELS = {
    en: { your: '★ Your Track', view: 'View integration module →', module: 'Integration Module', culture: 'Culture & Values', comms: 'Communication', systems: 'Systems', trainings: 'Trainings', shared: 'Shared org-wide', empty: 'Details coming soon.', cultureNote: 'Culture & communication onboarding is shared across every department — no matter which track you join.' },
    de: { your: '★ Ihr Bereich', view: 'Integrationsmodul ansehen →', module: 'Integrationsmodul', culture: 'Kultur & Werte', comms: 'Kommunikation', systems: 'Systeme', trainings: 'Schulungen', shared: 'Organisationsweit geteilt', empty: 'Details folgen in Kürze.', cultureNote: 'Das Onboarding für Kultur & Kommunikation ist abteilungsübergreifend – unabhängig von Ihrem Bereich.' },
    zh: { your: '★ 您的板块', view: '查看整合模块 →', module: '整合模块', culture: '文化与价值观', comms: '沟通', systems: '系统', trainings: '培训', shared: '全组织共享', empty: '详情即将公布。', cultureNote: '文化与沟通入职培训在所有部门间共享——无论您加入哪个板块。' },
    cs: { your: '★ Váš úsek', view: 'Zobrazit integrační modul →', module: 'Integrační modul', culture: 'Kultura a hodnoty', comms: 'Komunikace', systems: 'Systémy', trainings: 'Školení', shared: 'Sdíleno v celé organizaci', empty: 'Podrobnosti již brzy.', cultureNote: 'Onboarding kultury a komunikace je sdílený napříč všemi odděleními – bez ohledu na váš úsek.' }
  };

  function deptTrackLabels() {
    const lang = localStorage.getItem('employeeLanguage') || 'en';
    return DEPT_TRACK_LABELS[lang] || DEPT_TRACK_LABELS.en;
  }

  function employeeOwnsDept(d) {
    // Map the employee's free-text department to a track, mirroring the timeline
    // mapping (rd/sales/finance) used elsewhere on this page, then match the dept id.
    const own = (dept || '').trim().toLowerCase();
    if (!own) return false;
    let deptId = null;
    if (own.includes('r&d') || own.includes('eng') || own.includes('prod') || own.includes('tech')) deptId = 'dept_product';
    else if (own.includes('sale') || own.includes('mkt') || own.includes('biz')) deptId = 'dept_sales';
    else if (own.includes('fin') || own.includes('audit') || own.includes('tax')) deptId = 'dept_finance';
    if (deptId && d.id === deptId) return true;
    // Fallback for custom departments: direct name substring match.
    return own.length > 2 && (d.name || '').toLowerCase().includes(own);
  }

  function renderEmployeeDeptTracks() {
    const container = document.getElementById('employee-dept-tracks');
    if (!container) return;
    fetch('/api/departments').then(r => r.json()).then(depts => {
      const L = deptTrackLabels();
      container.innerHTML = '';
      (depts || []).forEach(d => {
        const mine = employeeOwnsDept(d);
        const card = document.createElement('div');
        card.className = 'card placeholder-card';
        card.style.cssText = 'padding:1.25rem;margin-bottom:0;cursor:pointer;text-align:left;' + (mine ? 'border:1.5px solid var(--te-orange);' : '');
        card.innerHTML = `
          <h4 style="font-size:0.95rem;text-align:left;margin-bottom:0.25rem;">${d.icon ? escapeHtml(d.icon) + ' ' : ''}${escapeHtml(d.name || '')}</h4>
          <p style="font-size:0.75rem;text-align:left;">${escapeHtml(d.desc || '')}</p>
          <span class="placeholder-badge" style="font-size:0.6rem;padding:0.15rem 0.5rem;align-self:flex-start;${mine ? 'background:rgba(233,131,0,0.12);color:var(--te-orange);border-color:rgba(233,131,0,0.3);' : ''}">${mine ? L.your : L.view}</span>`;
        card.addEventListener('click', () => openEmployeeDeptModal(d));
        container.appendChild(card);
      });
    }).catch(err => console.error('Error loading department tracks:', err));
  }

  function openEmployeeDeptModal(d) {
    const L = deptTrackLabels();
    const list = (items) => (items && items.length)
      ? `<ul style="margin:0.35rem 0 0;padding-left:1.1rem;">${items.map(i => `<li style="margin-bottom:0.35rem;"><strong>${escapeHtml(i.title || '')}</strong>${i.desc ? ' — <span style="color:var(--text-secondary);">' + escapeHtml(i.desc) + '</span>' : ''}</li>`).join('')}</ul>`
      : `<p style="color:var(--text-dim);font-size:0.85rem;margin:0.35rem 0 0;">${L.empty}</p>`;
    const overlay = document.createElement('div');
    overlay.className = 'cms-modal-overlay';
    const box = document.createElement('div');
    box.className = 'cms-modal';
    box.style.maxWidth = '560px';
    box.innerHTML = `
      <div class="cms-modal-head"><h3>${d.icon ? escapeHtml(d.icon) + ' ' : ''}${escapeHtml(d.name || '')} — ${L.module}</h3><button type="button" class="cms-modal-x" aria-label="Close">✕</button></div>
      <div class="cms-modal-body">
        <div class="dept-section">
          <h4 class="dept-section-h">🎭 ${L.culture} <span class="dept-shared">${L.shared}</span></h4>
          <p style="font-size:0.83rem;color:var(--text-secondary);margin:0.35rem 0 0;">${L.cultureNote}</p>
        </div>
        <div class="dept-section">
          <h4 class="dept-section-h">📣 ${L.comms} <span class="dept-shared">${L.shared}</span></h4>
        </div>
        <div class="dept-section">
          <h4 class="dept-section-h">⚙️ ${L.systems} <span class="dept-own">${escapeHtml(d.name || '')}</span></h4>
          ${list(d.systems)}
        </div>
        <div class="dept-section">
          <h4 class="dept-section-h">🎓 ${L.trainings} <span class="dept-own">${escapeHtml(d.name || '')}</span></h4>
          ${list(d.trainings)}
        </div>
      </div>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    box.querySelector('.cms-modal-x').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
  }

  // Populate profiles
  function renderProfileCard(emp) {
    const profileName = document.getElementById('academy-employee-name');
    const profileTitle = document.getElementById('academy-employee-title');
    const badgeDisplay = document.getElementById('academy-badge-display');
    const xpDisplay = document.getElementById('academy-xp-display');
    const progressPercent = document.getElementById('academy-progress-percent');
    const progressFill = document.getElementById('academy-progress-bar-fill');
    const completedText = document.getElementById('academy-completed-text');
    const avatarChar = document.getElementById('academy-avatar-char');
    const avatarBadge = document.getElementById('academy-avatar-badge-tier');

    const lang = localStorage.getItem('employeeLanguage') || 'en';
    const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;

    if (profileName) profileName.textContent = emp.name;
    
    if (profileTitle) {
      let trackKey = 'general';
      const cleanDept = emp.department ? emp.department.trim().toLowerCase() : 'operations';
      if (cleanDept.includes('r&d') || cleanDept.includes('eng') || cleanDept.includes('prod') || cleanDept.includes('tech')) {
        trackKey = 'rd';
      } else if (cleanDept.includes('sale') || cleanDept.includes('mkt') || cleanDept.includes('biz')) {
        trackKey = 'sales';
      } else if (cleanDept.includes('fin') || cleanDept.includes('audit') || cleanDept.includes('tax')) {
        trackKey = 'finance';
      }
      const trackData = TIMELINE_DATA[trackKey];
      const transDept = dict[trackData.badgeKey] || dict.track_general;
      profileTitle.textContent = `${emp.role} ── ${transDept} (${emp.company})`;
    }

    let transBadge = emp.badge || "New Recruit";
    if (emp.badge === 'Ultimate Integrator') transBadge = dict.badge_ultimate_integrator;
    else if (emp.badge === 'Synergy Scout') transBadge = dict.badge_synergy_scout;
    else if (emp.badge === 'Systems Scholar') transBadge = dict.badge_systems_scholar;
    else if (emp.badge === 'Culture Champion') transBadge = dict.badge_culture_champion;
    else if (emp.badge === 'New Recruit') transBadge = dict.badge_new_recruit;

    if (badgeDisplay) {
      badgeDisplay.textContent = transBadge;
      if (emp.badge === 'Ultimate Integrator') {
        badgeDisplay.style.backgroundColor = '#10B981';
      } else if (emp.badge === 'Synergy Scout') {
        badgeDisplay.style.backgroundColor = '#3B82F6';
      } else if (emp.badge === 'Systems Scholar') {
        badgeDisplay.style.backgroundColor = '#8B5CF6';
      } else if (emp.badge === 'Culture Champion') {
        badgeDisplay.style.backgroundColor = 'var(--te-dark-teal)';
      } else {
        badgeDisplay.style.backgroundColor = 'var(--te-orange)';
      }
    }
    if (xpDisplay) xpDisplay.innerHTML = `${emp.points || 0} <span style="font-size: 0.85rem; font-weight: 500; color: var(--text-dim);">XP</span>`;

    // Calculate completions percent
    const completedCount = emp.completedLessons ? emp.completedLessons.length : 0;
    const percent = Math.round((completedCount / 9) * 100);

    if (progressPercent) progressPercent.textContent = `${percent}%`;
    if (progressFill) progressFill.style.width = `${percent}%`;
    if (completedText) completedText.textContent = dict.academy_completed.replace('{completed}', completedCount.toString());

    // Avatar dynamics
    if (avatarChar) {
      if (emp.badge === 'Ultimate Integrator') avatarChar.textContent = '👑';
      else if (emp.badge === 'Synergy Scout') avatarChar.textContent = '🚀';
      else if (emp.badge === 'Systems Scholar') avatarChar.textContent = '🧠';
      else if (emp.badge === 'Culture Champion') avatarChar.textContent = '🤝';
      else avatarChar.textContent = '👤';
    }

    if (avatarBadge) {
      if (emp.badge === 'Ultimate Integrator') avatarBadge.textContent = '💎';
      else if (emp.badge === 'Synergy Scout') avatarBadge.textContent = '🔥';
      else if (emp.badge === 'Systems Scholar') avatarBadge.textContent = '⭐';
      else if (emp.badge === 'Culture Champion') avatarBadge.textContent = '⚡';
      else avatarBadge.textContent = '⭐';
    }
    
    // Refresh streak multiplier badge display
    if (typeof renderStreakBadge === 'function') {
      renderStreakBadge();
    }

    // Populate integration profile details
    const roleProfileName = document.getElementById('role-profile-name');
    const roleProfileTitle = document.getElementById('role-profile-title');
    const roleProfileDept = document.getElementById('role-profile-dept');
    const roleProfileEmail = document.getElementById('role-profile-email');

    if (roleProfileName) roleProfileName.textContent = emp.name;
    if (roleProfileTitle) roleProfileTitle.textContent = emp.role;
    if (roleProfileDept) roleProfileDept.textContent = emp.department || 'Operations';
    if (roleProfileEmail) {
      roleProfileEmail.textContent = emp.email || `${emp.name.toLowerCase().replace(/\s+/g, '')}@te-legacy.com`;
    }
  }

  // Update checkmarks in HTML
  function syncAcademyCheckboxes(emp) {
    const checkboxes = document.querySelectorAll('.academy-lesson-checkbox');
    const completed = emp.completedLessons || [];

    checkboxes.forEach(chk => {
      const lessonId = chk.getAttribute('data-lesson-id');
      chk.checked = completed.includes(lessonId);

      // Add parent item styling
      const parentItem = chk.closest('.academy-lesson-item');
      if (parentItem) {
        if (chk.checked) {
          parentItem.style.opacity = '0.9';
          parentItem.style.transform = 'scale(0.99)';
        } else {
          parentItem.style.opacity = '1';
          parentItem.style.transform = 'none';
        }
      }
    });
  }

  // Delegated change listener — works for dynamically rendered lessons
  document.addEventListener('change', (ev) => {
      const chk = ev.target;
      if (!chk || !chk.classList || !chk.classList.contains('academy-lesson-checkbox')) return;
      if (!activeEmployee) return;

      const lessonId = chk.getAttribute('data-lesson-id');
      const isChecking = chk.checked;
      const endpoint = isChecking ? '/api/employees/complete-lesson' : '/api/employees/uncomplete-lesson';

      chk.disabled = true;

      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empId: activeEmployee.id, lessonId })
      })
        .then(res => res.json())
        .then(data => {
          chk.disabled = false;
          if (data.success) {
            const prevBadge = activeEmployee.badge;
            activeEmployee = data.employee;
            
            renderProfileCard(activeEmployee);
            syncAcademyCheckboxes(activeEmployee);
            updateMilestones(activeEmployee.points || 0);
            loadLeaderboard(activeEmployee.id);

            // Confetti, Audio popped chimes, and Streaks!
            if (isChecking) {
              // 1. Play POP double-sine chime
              playPopChime();

              // 2. Localized card burst
              const lessonItem = chk.closest('.academy-lesson-item');
              if (lessonItem) {
                triggerCardConfetti(lessonItem);
              } else {
                triggerConfetti();
              }

              // 3. Consecutive lesson streak increment
              let streak = (parseInt(sessionStorage.getItem('lessonStreak')) || 0) + 1;
              sessionStorage.setItem('lessonStreak', streak.toString());
              renderStreakBadge();

              // Check if badge upgraded
              if (activeEmployee.badge !== prevBadge) {
                showBadgeUpgradePopup(activeEmployee.badge);
              }
            } else {
              // Break streak on uncheck
              sessionStorage.setItem('lessonStreak', '0');
              renderStreakBadge();
            }
          }
        })
        .catch(err => {
          chk.disabled = false;
          chk.checked = !isChecking; // revert
          console.error("Error updating lesson completion:", err);
        });
  });

  // Beautiful Badge upgrade alert overlays
  function showBadgeUpgradePopup(newBadge) {
    const lang = localStorage.getItem('employeeLanguage') || 'en';
    const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
    
    let transBadge = newBadge;
    if (newBadge === 'Ultimate Integrator') transBadge = dict.badge_ultimate_integrator;
    else if (newBadge === 'Synergy Scout') transBadge = dict.badge_synergy_scout;
    else if (newBadge === 'Systems Scholar') transBadge = dict.badge_systems_scholar;
    else if (newBadge === 'Culture Champion') transBadge = dict.badge_culture_champion;
    else if (newBadge === 'New Recruit') transBadge = dict.badge_new_recruit;

    const alertDiv = document.createElement('div');
    alertDiv.style = `
      position: fixed;
      top: 20%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0.9);
      background: linear-gradient(135deg, var(--te-dark-teal), #1a3742);
      color: white;
      padding: 2rem;
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      z-index: 10000;
      text-align: center;
      border: 3px solid var(--te-orange);
      opacity: 0;
      transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    `;

    alertDiv.innerHTML = `
      <div style="font-size: 3rem; margin-bottom: 0.5rem;">🏆</div>
      <h3 style="color: var(--te-orange); margin: 0 0 0.5rem 0; font-size: 1.6rem; font-family: var(--font-family-display);">${dict.badge_promotion_title}</h3>
      <p style="margin: 0 0 1rem 0; font-size: 1rem;">${dict.badge_promotion_subtitle}<br><strong style="font-size: 1.25rem; color: #FFF;">${transBadge}</strong>!</p>
      <button class="btn btn-primary" style="margin: 0; padding: 0.5rem 1.5rem;" id="btn-close-upgrade">${dict.btn_awesome}</button>
    `;

    document.body.appendChild(alertDiv);

    requestAnimationFrame(() => {
      alertDiv.style.opacity = '1';
      alertDiv.style.transform = 'translate(-50%, -50%) scale(1)';
    });

    const closeBtn = alertDiv.querySelector('#btn-close-upgrade');
    closeBtn.addEventListener('click', () => {
      alertDiv.style.opacity = '0';
      alertDiv.style.transform = 'translate(-50%, -50%) scale(0.9)';
      setTimeout(() => alertDiv.remove(), 300);
    });

    // Also trigger extra particles!
    triggerConfetti();
    setTimeout(triggerConfetti, 300);
  }

  // Update Milestones (Horizontal Stepper progress bar & Details panel)
  function updateMilestones(xp) {
    const container = document.getElementById('milestones-timeline-container');
    if (!container) return;

    // TEd game milestone follows the admin-controlled settings flag.
    const isDoomEnabled = portalSettings.doomGloballyEnabled !== false;
    // Cap the unlock at the lesson XP ceiling so completing ALL lessons is always enough
    // to reach it — otherwise the reward is unreachable (lessons top out below 220 XP).
    const lessonCount = (typeof academyCourses !== 'undefined' && academyCourses)
      ? academyCourses.reduce((n, c) => n + (c.modules || []).reduce((mn, m) => mn + ((m.lessons || []).length), 0), 0)
      : 9;
    const lessonCeilingXp = (lessonCount || 9) * 20;
    const doomXp = Math.min(portalSettings.doomUnlockXp || 220, lessonCeilingXp);

    const lang = localStorage.getItem('employeeLanguage') || 'en';
    const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;

    const milestones = [
      { score: 50, id: 'm-50', text: dict.milestone_welcome_kit || 'Welcome Merch Kit', desc: dict.milestone_welcome_kit_desc || 'TE T-Shirt, Tech Tumbler, TEodor Duck Sticker.' },
      { score: 100, id: 'm-100', text: dict.milestone_certified_badge || 'Certified Integrator Badge', desc: dict.milestone_certified_badge_desc || 'Official Digital Badge & Certificate.' },
      { score: 150, id: 'm-150', text: dict.milestone_bonus_tier || 'Retention Bonus Tier 1', desc: dict.milestone_bonus_tier_desc || 'Unlocks eligibility for post-merger integration bonus.' },
      { score: 200, id: 'm-200', text: dict.milestone_spotlight || 'IMO Spotlight Showcase', desc: dict.milestone_spotlight_desc || 'Featured employee profile in standard IMO newsletter.' }
    ];

    if (isDoomEnabled) {
      milestones.push({
        score: doomXp,
        id: 'm-doom',
        text: dict.milestone_doom || 'TEd Gateway',
        desc: dict.milestone_doom_desc || 'Unlock the custom retro corporate ladder 2D platformer game TEd.'
      });
    }

    // Sort milestones by score to be absolutely safe
    milestones.sort((a, b) => a.score - b.score);

    // Calculate overall timeline progress fill percent
    const maxScore = milestones[milestones.length - 1].score;
    const fillPercent = Math.min(100, Math.max(0, (xp / maxScore) * 100));
    
    // Update timeline progress bar fill width
    const fillBar = document.getElementById('milestones-timeline-progress-fill');
    if (fillBar) {
      fillBar.style.width = `${fillPercent}%`;
    }

    // Clear old steps (except the fill bar)
    const existingSteps = container.querySelectorAll('.milestone-step-horizontal');
    existingSteps.forEach(s => s.remove());

    let activeSelectedMilestone = null;

    // Draw nodes dynamically
    milestones.forEach((m, idx) => {
      const isCompleted = xp >= m.score;
      const stepDiv = document.createElement('div');
      stepDiv.className = `milestone-step-horizontal ${isCompleted ? 'completed' : 'locked'}`;
      stepDiv.id = `step-${m.id}`;

      // Left percentage placement for responsive alignment
      const stepPercent = (m.score / maxScore) * 100;
      stepDiv.style.left = `calc(${stepPercent}% - 16px)`;
      stepDiv.style.position = 'absolute';

      let statusSymbol = '🔒';
      if (isCompleted) {
        statusSymbol = m.id === 'm-doom' ? '🔑' : '✅';
      }

      // Check if it's the active next milestone
      const isCurrentActive = !isCompleted && (idx === 0 || xp >= milestones[idx - 1].score);
      if (isCurrentActive) {
        stepDiv.classList.add('active');
        statusSymbol = '⚙️';
        activeSelectedMilestone = m;
      }

      // If all are completed, default detail displays the final milestone (DOOM/TEd)
      if (isCompleted && idx === milestones.length - 1 && !activeSelectedMilestone) {
        activeSelectedMilestone = m;
      }

      stepDiv.innerHTML = `
        <span class="milestone-step-xp">${m.score} XP</span>
        <div class="milestone-step-node" id="node-${m.id}">${statusSymbol}</div>
        <span class="milestone-step-label" style="display: none;">${escapeHtml(m.text.split(' ')[0])}</span>
      `;

      // Hover / Click Inspector handler
      const nodeEl = stepDiv.querySelector('.milestone-step-node');
      
      const showDetails = () => {
        const detailTitle = document.getElementById('milestone-detail-title');
        const detailDesc = document.getElementById('milestone-detail-desc');
        if (!detailTitle || !detailDesc) return;

        let statusText = isCompleted ? '🔓 UNLOCKED' : '🔒 LOCKED';
        if (isCurrentActive) statusText = '⚙️ ACTIVE FOCUS';

        detailTitle.innerHTML = `<span style="color: ${isCompleted ? '#10B981' : (isCurrentActive ? 'var(--te-orange)' : 'var(--text-dim)')}; font-weight: 800;">${statusText}: ${escapeHtml(m.text)} (${m.score} XP)</span>`;
        
        if (m.id === 'm-doom' && isCompleted) {
          detailDesc.innerHTML = `${escapeHtml(m.desc)} <strong style="color: #EF4444; display: block; margin-top: 0.25rem; cursor: pointer;" id="btn-launch-ted-gate">👾 Click here to launch the TEd Workstation Console!</strong>`;
          const btnLaunch = detailDesc.querySelector('#btn-launch-ted-gate');
          if (btnLaunch) {
            btnLaunch.onclick = function() {
              if (typeof window.launchDoomProtocol === 'function') {
                window.launchDoomProtocol();
              }
            };
          }
        } else {
          detailDesc.textContent = m.desc;
        }
      };

      nodeEl.addEventListener('mouseenter', showDetails);
      nodeEl.addEventListener('click', showDetails);

      container.appendChild(stepDiv);
    });

    // Default detail displays the active selected milestone
    if (activeSelectedMilestone) {
      const nodeEl = document.getElementById(`node-${activeSelectedMilestone.id}`);
      if (nodeEl) {
        // Trigger default click
        nodeEl.dispatchEvent(new Event('click'));
      }
    }
  }

  // Load the Leaderboard
  function loadLeaderboard(currentEmpId) {
    const leaderboardContainer = document.getElementById('academy-leaderboard-container');
    if (!leaderboardContainer) return;

    const lang = localStorage.getItem('employeeLanguage') || 'en';
    const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;

    fetch('/api/employees')
      .then(res => res.json())
      .then(employees => {
        leaderboardContainer.innerHTML = '';
        
        employees.sort((a, b) => (b.points || 0) - (a.points || 0));

        employees.forEach((emp, index) => {
          const isMe = emp.id === currentEmpId;
          const rank = index + 1;
          
          let rankBadge = `${rank}`;
          let borderHighlight = '';
          let bgStyle = 'background: var(--bg-white);';

          if (rank === 1) {
            rankBadge = '🥇';
            borderHighlight = 'border-left: 4px solid #F59E0B;';
          } else if (rank === 2) {
            rankBadge = '🥈';
            borderHighlight = 'border-left: 4px solid #94A3B8;';
          } else if (rank === 3) {
            rankBadge = '🥉';
            borderHighlight = 'border-left: 4px solid #B45309;';
          }

          if (isMe) {
            bgStyle = 'background: rgba(233, 131, 0, 0.08);';
            borderHighlight = 'border: 2px solid var(--te-orange);';
          }

          const row = document.createElement('div');
          row.className = 'leaderboard-roster-row-premium';
          row.style = `display: flex; align-items: center; justify-content: space-between; padding: 0.75rem; border-radius: var(--radius-md); box-shadow: 0 2px 5px rgba(0,0,0,0.02); transition: all 0.2s; ${bgStyle} ${borderHighlight}`;
          
          const completedCount = emp.completedLessons ? emp.completedLessons.length : 0;

          let transBadge = emp.badge || "New Recruit";
          if (emp.badge === 'Ultimate Integrator') transBadge = dict.badge_ultimate_integrator;
          else if (emp.badge === 'Synergy Scout') transBadge = dict.badge_synergy_scout;
          else if (emp.badge === 'Systems Scholar') transBadge = dict.badge_systems_scholar;
          else if (emp.badge === 'Culture Champion') transBadge = dict.badge_culture_champion;
          else if (emp.badge === 'New Recruit') transBadge = dict.badge_new_recruit;

          row.innerHTML = `
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <span style="font-size: 1.1rem; font-weight: 700; width: 25px; text-align: center;">${rankBadge}</span>
              <div>
                <div style="font-weight: 700; color: var(--te-dark-teal); font-size: 0.9rem;">
                  ${escapeHtml(emp.name)} ${isMe ? '<span style="background: var(--te-orange); color: white; font-size: 0.65rem; padding: 0.1rem 0.35rem; border-radius: 10px; margin-left: 0.25rem;">You</span>' : ''}
                </div>
                <div style="font-size: 0.75rem; color: var(--text-secondary);">${escapeHtml(emp.role)} &bull; ${escapeHtml(transBadge)}</div>
              </div>
            </div>
            <div style="text-align: right;">
              <div style="font-weight: 700; color: var(--te-orange); font-size: 0.95rem;">${emp.points || 0} XP</div>
              <div style="font-size: 0.7rem; color: var(--text-dim);">${completedCount}/9 completed</div>
            </div>
          `;
          leaderboardContainer.appendChild(row);
        });
      })
      .catch(err => console.error("Error loading leaderboard:", err));
  }

  // Load diagnostics averages to toggle priority action warnings
  function fetchDiagnosticsPriority() {
    fetch('/api/assessment/latest')
      .then(res => res.json())
      .then(data => {
        if (data && data.scores) {
          const scores = data.scores;
          
          const bannerCulture = document.getElementById('banner-culture-priority');
          const bannerTalent = document.getElementById('banner-talent-priority');
          const bannerValue = document.getElementById('banner-value-priority');

          if (bannerCulture && scores.culture !== undefined) {
            bannerCulture.style.display = scores.culture < 3.5 ? 'flex' : 'none';
          }
          if (bannerTalent && scores.talent !== undefined) {
            bannerTalent.style.display = scores.talent < 3.5 ? 'flex' : 'none';
          }
          if (bannerValue && scores.value !== undefined) {
            bannerValue.style.display = scores.value < 3.5 ? 'flex' : 'none';
          }
        }
      })
      .catch(err => console.error("Error loading assessment diagnostics priority:", err));
  }

  // Confetti engine
  function triggerConfetti() {
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.top = '0';
    container.style.left = '0';
    container.style.width = '100vw';
    container.style.height = '100vh';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '9999';
    document.body.appendChild(container);

    const colors = ['#E98300', '#244C5A', '#FBBF24', '#3B82F6', '#10B981'];

    for (let i = 0; i < 60; i++) {
      const particle = document.createElement('div');
      particle.style.position = 'absolute';
      particle.style.width = Math.random() * 8 + 6 + 'px';
      particle.style.height = Math.random() * 12 + 6 + 'px';
      particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      particle.style.left = '50%';
      particle.style.top = '40%';
      particle.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      particle.style.transform = 'translate(-50%, -50%)';
      particle.style.opacity = '1';
      
      const angle = Math.random() * Math.PI * 2;
      const velocity = Math.random() * 12 + 8;
      const vx = Math.cos(angle) * velocity;
      const vy = Math.sin(angle) * velocity - 5;
      
      container.appendChild(particle);

      let x = 0;
      let y = 0;
      let gravity = 0.5;
      let currentVx = vx;
      let currentVy = vy;
      let rotation = Math.random() * 360;
      let rotSpeed = Math.random() * 10 - 5;

      const interval = setInterval(() => {
        x += currentVx;
        y += currentVy;
        currentVy += gravity;
        currentVx *= 0.98;
        rotation += rotSpeed;

        particle.style.left = `calc(50% + ${x}px)`;
        particle.style.top = `calc(40% + ${y}px)`;
        particle.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
        
        const currentOpacity = parseFloat(particle.style.opacity);
        if (currentVy > 5) {
          particle.style.opacity = (currentOpacity - 0.05).toString();
        }

        if (parseFloat(particle.style.opacity) <= 0) {
          clearInterval(interval);
          particle.remove();
        }
      }, 20);
    }

    setTimeout(() => {
      container.remove();
    }, 3000);
  }

  // Helper: Escape HTML strings safely
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // --- 10. SYSTEM INITIALIZATION SEQUENCE ---

  // Load announcements initially
  loadEmployeeAlerts();
  
  // Load video settings initially
  loadVideoSettings();

  // --- 11. SECONDARY STICKY SUBMENU STEERING & SCROLL TRACKING ---
  function setupSubmenuSteering() {
    const submenuItems = document.querySelectorAll('.portal-submenu-bar .submenu-item');
    if (submenuItems.length === 0) return;

    submenuItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = item.getAttribute('href');
        const targetElement = document.querySelector(targetId);
        if (!targetElement) return;

        // Check if the target is inside a tab panel
        let parentTab = targetElement.closest('.portal-tab-content');
        if (parentTab) {
          const tabId = parentTab.id.replace('portal-tab-content-', '');
          const correspondingTabBtn = document.querySelector(`.portal-tab-btn[data-portal-tab="${tabId}"]`);
          if (correspondingTabBtn && !correspondingTabBtn.classList.contains('active')) {
            correspondingTabBtn.click();
          }
        }
      });
    });

    // Scroll listener for highlight active submenu item
    window.addEventListener('scroll', () => {
      let currentActiveId = "";
      const scrollPos = window.scrollY + 160; // Offset for sticky headers

      submenuItems.forEach(item => {
        const targetId = item.getAttribute('href');
        const targetElement = document.querySelector(targetId);
        if (targetElement) {
          // If the element is hidden (its tab is not active), ignore it
          const parentTab = targetElement.closest('.portal-tab-content');
          if (parentTab && parentTab.style.display === 'none') {
            return;
          }

          const top = targetElement.offsetTop;
          const height = targetElement.offsetHeight;
          if (scrollPos >= top && scrollPos < top + height) {
            currentActiveId = targetId;
          }
        }
      });

      // Special fallback if near bottom of page
      if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 10) {
        currentActiveId = "#helpdesk-section";
      }

      // If nothing matches and we're near the top, highlight academy or roadmap depending on active tab
      if (!currentActiveId) {
        const activeTabBtn = document.querySelector('.portal-tab-btn.active');
        if (activeTabBtn) {
          const activeTab = activeTabBtn.getAttribute('data-portal-tab');
          currentActiveId = `#portal-tab-content-${activeTab}`;
        }
      }

      submenuItems.forEach(item => {
        if (item.getAttribute('href') === currentActiveId) {
          item.classList.add('active');
        } else {
          item.classList.remove('active');
        }
      });
    });
  }

  // --- 8. DYNAMIC EVENTS HUB CALENDAR SYSTEM ---
  const INTEGRATION_EVENTS = [
    { day: 15, key: "cal_e1", title: "Day 1 Kickoff & Welcome Breakfast", type: "news", time: "09:00 CET", desc: "Welcome breakfast in the lobby, site leader address, and distribution of physical Welcome Kits!" },
    { day: 18, key: "cal_e2", title: "IT Accounts SSO Registration", type: "training", time: "11:00 CET", desc: "Deadline to complete SSO registration and activate your new TE corporate email inbox." },
    { day: 22, key: "cal_e3", title: "Q&A Session with IMO Integration Lead", type: "meeting", time: "15:00 CET", desc: "Drop-in virtual session to ask questions about system conversions and payroll transitions." },
    { day: 25, key: "cal_e4", title: "Cultural Integration Welcome Town Hall", type: "news", time: "10:00 CET", desc: "Join TE corporate executives and local leads for a combined welcome session and open Q&A. May 25, 10:00 CET." },
    { day: 26, key: "cal_e5", title: "Post-Merger Integration Review Meeting", type: "meeting", time: "14:00 CET", desc: "Join the Integration Management Office for the bi-weekly Post-Merger calibration sync on MS Teams. May 26, 14:00 CET." },
    { day: 28, key: "cal_e6", title: "TE Cybersecurity Systems Compliance Course", type: "training", time: "All Day", desc: "All newly acquired employees must complete the basic cybersecurity and compliance training within their first 30 days." }
  ];

  // Localized weekday abbreviations for the calendar header row
  const CAL_WEEKDAYS = {
    en: ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'],
    de: ['SO', 'MO', 'DI', 'MI', 'DO', 'FR', 'SA'],
    zh: ['日', '一', '二', '三', '四', '五', '六'],
    cs: ['NE', 'PO', 'ÚT', 'ST', 'ČT', 'PÁ', 'SO']
  };

  function currentCalDict() {
    const lang = localStorage.getItem('employeeLanguage') || 'en';
    return TRANSLATIONS[lang] || TRANSLATIONS.en;
  }

  // Localized "May {day}" (optionally with year) respecting each locale's order
  function localizedMayDate(day, withYear) {
    const lang = localStorage.getItem('employeeLanguage') || 'en';
    switch (lang) {
      case 'de': return `${day}. Mai` + (withYear ? ' 2026' : '');
      case 'zh': return (withYear ? '2026 年 ' : '') + `5 月 ${day} 日`;
      case 'cs': return `${day}. května` + (withYear ? ' 2026' : '');
      default: return `May ${day}` + (withYear ? ', 2026' : '');
    }
  }

  // Localized fields for a raw INTEGRATION_EVENTS entry
  function evTitle(e) { const d = currentCalDict(); return (e.key && d[e.key + '_title']) || e.title; }
  function evDesc(e) { const d = currentCalDict(); return (e.key && d[e.key + '_desc']) || e.desc; }
  function evType(e) { const d = currentCalDict(); return d['event_type_' + e.type] || e.type.toUpperCase(); }
  function evTime(e) { const d = currentCalDict(); return (e.time === 'All Day') ? d.all_day : e.time; }

  function renderEventsCalendar() {
    const grid = document.getElementById('events-calendar-grid');
    const title = document.getElementById('calendar-title');
    const prevBtn = document.getElementById('prev-month-btn');
    const nextBtn = document.getElementById('next-month-btn');
    
    if (!grid || !title) return;

    fetch('/api/settings')
      .then(res => res.json())
      .then(settings => {
        const activeTimelineDay = settings.timeTravelDay || 8;
        const currentCalendarDay = 14 + activeTimelineDay;

        const dict = currentCalDict();
        const lang = localStorage.getItem('employeeLanguage') || 'en';

        grid.innerHTML = '';
        title.textContent = dict.calendar_month; // Locked to May 2026 as per timeline

        // Localize weekday header row
        const weekdaysRow = document.querySelector('.calendar-weekdays');
        const wk = CAL_WEEKDAYS[lang] || CAL_WEEKDAYS.en;
        if (weekdaysRow) {
          weekdaysRow.querySelectorAll('div').forEach((cell, i) => { if (wk[i]) cell.textContent = wk[i]; });
        }

        // .onclick (not addEventListener) so repeated re-renders on language change don't stack handlers
        if (prevBtn) {
          prevBtn.onclick = () => alert("Timeline calendar is locked to the active post-merger month of May 2026.");
        }
        if (nextBtn) {
          nextBtn.onclick = () => alert("Timeline calendar is locked to the active post-merger month of May 2026.");
        }

        // May 2026 starts on Friday (5 empty cells)
        const firstDayIndex = 5;
        const totalDays = 31;

        // Render empty cells
        for (let i = 0; i < firstDayIndex; i++) {
          const emptyCell = document.createElement('div');
          emptyCell.className = 'calendar-day empty-cell';
          grid.appendChild(emptyCell);
        }

        // Render calendar days
        for (let d = 1; d <= totalDays; d++) {
          const cell = document.createElement('div');
          cell.className = 'calendar-day';
          cell.textContent = d;

          // Highlight today
          if (d === currentCalendarDay) {
            cell.classList.add('current-day-marker');
          }

          // Check if there is an event
          const dayEvent = INTEGRATION_EVENTS.find(e => e.day === d);
          if (dayEvent) {
            cell.classList.add('has-event');
            cell.setAttribute('title', evTitle(dayEvent));
          }

          cell.addEventListener('click', () => {
            grid.querySelectorAll('.calendar-day').forEach(c => c.classList.remove('active'));
            cell.classList.add('active');
            showSelectedEvent(d, dayEvent);
          });

          grid.appendChild(cell);
        }

        // Auto-click today or show today's event initially
        const todayCell = Array.from(grid.querySelectorAll('.calendar-day')).find(c => c.textContent == String(currentCalendarDay));
        if (todayCell) {
          todayCell.click();
        } else {
          showSelectedEvent(currentCalendarDay, INTEGRATION_EVENTS.find(e => e.day === currentCalendarDay));
        }

        renderFutureEventsDeck(currentCalendarDay);

        // --- COLLAPSED CALENDAR PREVIEW & STEERING LOGIC ---
        const nextEvent = INTEGRATION_EVENTS.find(e => e.day >= currentCalendarDay) || INTEGRATION_EVENTS[INTEGRATION_EVENTS.length - 1];
        const nextEventTextEl = document.getElementById('hidden-next-event-text');
        if (nextEventTextEl && nextEvent) {
          nextEventTextEl.innerHTML = `<span style="color: var(--te-orange); font-weight: bold;">${localizedMayDate(nextEvent.day, false)}:</span> ${escapeHtml(evTitle(nextEvent))} (🕒 ${escapeHtml(evTime(nextEvent))})`;
        }

        const toggleBtn = document.getElementById('toggle-calendar-btn');
        const quickExpandBtn = document.getElementById('quick-expand-btn');
        const collapsibleGrid = document.getElementById('calendar-collapsible-grid');
        const hiddenPreview = document.getElementById('calendar-hidden-preview');
        const toggleArrow = document.getElementById('toggle-calendar-arrow');

        function updateToggleState(isCollapsed) {
          if (isCollapsed) {
            collapsibleGrid.style.display = 'none';
            hiddenPreview.style.display = 'flex';
            if (toggleArrow) toggleArrow.textContent = '▼';
            localStorage.setItem('calendarCollapsed', 'true');
          } else {
            collapsibleGrid.style.display = 'flex';
            hiddenPreview.style.display = 'none';
            if (toggleArrow) toggleArrow.textContent = '▲';
            localStorage.setItem('calendarCollapsed', 'false');
          }
        }

        if (toggleBtn && collapsibleGrid && hiddenPreview) {
          toggleBtn.onclick = () => {
            const isCurrentlyCollapsed = collapsibleGrid.style.display === 'none';
            updateToggleState(!isCurrentlyCollapsed);
          };

          if (quickExpandBtn) {
            quickExpandBtn.onclick = () => {
              updateToggleState(false);
            };
          }

          // Maintain user toggle state preference on page refreshes
          const initiallyCollapsed = localStorage.getItem('calendarCollapsed') === 'true';
          updateToggleState(initiallyCollapsed);
        }
      })
      .catch(err => {
        console.error("Error loading events calendar settings:", err);
      });
  }

  function showSelectedEvent(dayNumber, dayEvent) {
    const banner = document.getElementById('selected-day-banner');
    if (!banner) return;

    const dict = currentCalDict();

    if (!dayEvent) {
      banner.className = 'event-banner-card empty';
      banner.innerHTML = `<p class="empty-event-text">${escapeHtml(dict.cal_no_event.replace('{date}', localizedMayDate(dayNumber, true)))}</p>`;
      return;
    }

    let typeIcon = "📢";
    if (dayEvent.type === 'meeting') typeIcon = "📅";
    if (dayEvent.type === 'training') typeIcon = "🛡️";

    banner.className = `event-banner-card active`;
    banner.innerHTML = `
      <div class="event-banner-header">
        <span class="event-badge ${dayEvent.type}">${escapeHtml(evType(dayEvent))}</span>
        <span class="event-time">🕒 ${escapeHtml(evTime(dayEvent))}</span>
      </div>
      <h4 class="event-card-title">${typeIcon} ${escapeHtml(evTitle(dayEvent))}</h4>
      <p class="event-card-desc">${escapeHtml(evDesc(dayEvent))}</p>
      <div class="event-card-meta">
        <span>📅 ${escapeHtml(localizedMayDate(dayNumber, true))}</span>
      </div>
    `;
  }

  function renderFutureEventsDeck(currentCalendarDay = 22) {
    const deck = document.getElementById('events-sidebar-deck');
    if (!deck) return;

    // Filter events on or after today's timeline day
    const futureEvents = INTEGRATION_EVENTS.filter(e => e.day >= currentCalendarDay).slice(0, 3);
    deck.innerHTML = '';

    if (futureEvents.length === 0) {
      deck.innerHTML = `<p style="font-size: 0.85rem; color: var(--text-dim); text-align: center; padding: 1rem;">${escapeHtml(currentCalDict().cal_no_upcoming)}</p>`;
      return;
    }

    futureEvents.forEach(e => {
      let typeIcon = "📢";
      if (e.type === 'meeting') typeIcon = "📅";
      if (e.type === 'training') typeIcon = "🛡️";

      const item = document.createElement('div');
      item.className = 'future-event-item';
      item.innerHTML = `
        <div class="future-event-icon">${typeIcon}</div>
        <div class="future-event-info">
          <div class="future-event-title">${escapeHtml(evTitle(e))}</div>
          <div class="future-event-date">${escapeHtml(localizedMayDate(e.day, true))} @ ${escapeHtml(evTime(e))}</div>
        </div>
      `;

      item.addEventListener('click', () => {
        // Find cell in grid and click it
        const grid = document.getElementById('events-calendar-grid');
        if (grid) {
          const cells = grid.querySelectorAll('.calendar-day');
          const cell = Array.from(cells).find(c => c.textContent == String(e.day));
          if (cell) cell.click();
        }
      });

      deck.appendChild(item);
    });
  }

  function fetchPortalSettings(callback) {
    fetch('/api/settings')
      .then(res => res.json())
      .then(settings => {
        portalSettings.doomGloballyEnabled = (settings.doomGloballyEnabled !== false);
        portalSettings.doomUnlockXp = settings.doomUnlockXp !== undefined ? parseInt(settings.doomUnlockXp, 10) : 220;
        if (callback) callback();
      })
      .catch(err => {
        console.error("Error fetching portal settings:", err);
        if (callback) callback();
      });
  }

  // --- Employee System Notifications Banner Logic ---
  function loadEmployeeNotifications(emp) {
    const notifyArea = document.getElementById('employee-notifications-area');
    const notifyList = document.getElementById('employee-notifications-list');
    const btnToggle = document.getElementById('btn-toggle-notifications');
    const toggleText = document.getElementById('notifications-toggle-text');

    if (!notifyArea || !notifyList) return;

    // Toggle collapse event
    if (btnToggle) {
      btnToggle.onclick = (e) => {
        e.preventDefault();
        const dict = TRANSLATIONS[localStorage.getItem('employeeLanguage') || 'en'] || TRANSLATIONS.en;
        if (notifyList.style.display === 'none') {
          notifyList.style.display = 'flex';
          if (toggleText) toggleText.textContent = dict.notif_collapse;
          btnToggle.querySelector('span:last-child').textContent = '▼';
        } else {
          notifyList.style.display = 'none';
          if (toggleText) toggleText.textContent = dict.notif_expand;
          btnToggle.querySelector('span:last-child').textContent = '▲';
        }
      };
    }

    const employeeEmail = emp.email || `${emp.name.toLowerCase().replace(/\s+/g, '')}@te-legacy.com`;

    fetch('/api/communications')
      .then(res => res.json())
      .then(comms => {
        notifyList.innerHTML = '';
        
        // Filter: c.recipientType === 'all' OR c.recipientEmail === employeeEmail
        const matched = comms.filter(c => {
          return c.recipientType === 'all' || 
                 c.recipientEmail === employeeEmail || 
                 (c.recipientType === 'individual' && c.recipientEmail === employeeEmail);
        });

        if (matched.length === 0) {
          notifyArea.style.display = 'none';
          return;
        }

        // Sort descending by timestamp
        matched.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        notifyArea.style.display = 'block';

        matched.forEach(c => {
          const item = document.createElement('div');
          item.style.cssText = 'background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); padding: 1.25rem; border-radius: var(--radius-md); display: flex; flex-direction: column; gap: 0.5rem; border-left: 5px solid ' + getEmployeeTemplateColor(c.template) + '; box-shadow: var(--shadow-sm);';
          
          const dateStr = new Date(c.timestamp).toLocaleString();

          item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; flex-wrap: wrap;">
              <div>
                <span class="badge" style="background: ${getEmployeeTemplateColor(c.template)}; color: white; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: bold; margin-bottom: 0.25rem; display: inline-block;">${getEmployeeTemplateLabel(c.template)}</span>
                <h4 style="margin: 0.25rem 0; font-size: 1.05rem; color: var(--text-main); font-family: var(--font-family-display); font-weight: 700;">${escapeHtml(c.subject)}</h4>
                <div style="font-size: 0.75rem; color: var(--text-dim); margin-top: 0.15rem;">
                  <span><strong>From:</strong> ${escapeHtml(c.sender)} (${escapeHtml(c.senderRole)})</span> &bull; 
                  <span>${dateStr}</span>
                </div>
              </div>
              <a href="${c.htmlEmailPath}" target="_blank" class="btn btn-secondary" style="padding: 0.3rem 0.6rem; font-size: 0.8rem; display: flex; align-items: center; gap: 0.3rem; text-decoration: none; border-radius: 4px; border: 1.5px solid ${getEmployeeTemplateColor(c.template)}; background: transparent; color: ${getEmployeeTemplateColor(c.template)}; font-weight: bold; cursor: pointer; transition: all 0.2s;">
                <span>📧</span> View Simulated Email
              </a>
            </div>
            <p style="margin: 0; font-size: 0.85rem; color: var(--text-secondary); line-height: 1.5; white-space: pre-line;">
              ${escapeHtml(c.body)}
            </p>
          `;

          notifyList.appendChild(item);
        });

        // Populate employee communications inbox tab container
        const inboxContainer = document.getElementById('employee-communications-inbox');
        if (inboxContainer) {
          inboxContainer.innerHTML = '';
          if (matched.length === 0) {
            inboxContainer.innerHTML = `<p style="text-align: center; color: var(--text-dim); font-size: 0.85rem; padding: 2rem; font-style: italic;">No communication records found.</p>`;
          } else {
            matched.forEach(c => {
              const item = document.createElement('div');
              item.className = 'card';
              item.style.cssText = 'border-left: 4px solid ' + getEmployeeTemplateColor(c.template) + '; margin-bottom: 1rem; padding: 1.25rem;';
              const dateStr = new Date(c.timestamp).toLocaleString();
              item.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; flex-wrap: wrap;">
                  <div>
                    <span class="badge" style="background: ${getEmployeeTemplateColor(c.template)}; color: white; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: bold; margin-bottom: 0.25rem; display: inline-block;">${getEmployeeTemplateLabel(c.template)}</span>
                    <h4 style="margin: 0.25rem 0; font-size: 1.05rem; color: var(--text-main); font-family: var(--font-family-display); font-weight: 700;">${escapeHtml(c.subject)}</h4>
                    <div style="font-size: 0.75rem; color: var(--text-dim); margin-top: 0.15rem;">
                      <span><strong>From:</strong> ${escapeHtml(c.sender)} (${escapeHtml(c.senderRole)})</span> &bull; 
                      <span>${dateStr}</span>
                    </div>
                  </div>
                  <a href="${c.htmlEmailPath}" target="_blank" class="btn btn-secondary" style="padding: 0.3rem 0.6rem; font-size: 0.8rem; display: flex; align-items: center; gap: 0.3rem; text-decoration: none; border-radius: 4px; border: 1.5px solid ${getEmployeeTemplateColor(c.template)}; background: transparent; color: ${getEmployeeTemplateColor(c.template)}; font-weight: bold; cursor: pointer; transition: all 0.2s;">
                    <span>📧</span> View Simulated Email
                  </a>
                </div>
                <p style="margin: 1rem 0 0; font-size: 0.85rem; color: var(--text-secondary); line-height: 1.5; white-space: pre-line;">
                  ${escapeHtml(c.body)}
                </p>
              `;
              inboxContainer.appendChild(item);
            });
          }
        }
      })
      .catch(err => console.error("Error loading employee notifications:", err));
  }

  function getEmployeeTemplateColor(tmpl) {
    switch (tmpl) {
      case 'security': return '#B91C1C'; // Crimson
      case 'synergy': return '#E98300'; // TE Orange
      case 'welcome': return '#244C5A'; // Dark Teal
      default: return '#374151'; // Charcoal
    }
  }

  function getEmployeeTemplateLabel(tmpl) {
    switch (tmpl) {
      case 'security': return 'Security & Compliance Alert';
      case 'synergy': return 'Cultural Synergy Capture';
      case 'welcome': return 'Welcome Announcement';
      default: return 'System Integration Notice';
    }
  }

  // Load dynamic employee profiles & trigger translation engine on load
  // Sync the employee academy with the shared portal language switcher (Phase 4)
  document.addEventListener('portalLanguageChanged', (e) => {
    const lang = e && e.detail;
    if (!lang) return;
    setLanguage(lang);
    const ls = document.getElementById('language-select');
    if (ls) ls.value = lang;
  });

  fetchPortalSettings(() => {
    initializeEmployee();
    renderEventsCalendar();
  });

  // Setup submenu steering (Removed duplicate submenu bar)
  // setupSubmenuSteering();

  // Setup language selector event listener
  const langSelect = document.getElementById('language-select');
  if (langSelect) {
    langSelect.addEventListener('change', (e) => {
      setLanguage(e.target.value);
    });
    
    // Check local storage for persistent preference, default to 'en'
    const storedLang = localStorage.getItem('employeeLanguage') || 'en';
    setLanguage(storedLang);
  } else {
    generateTimeline(dept, 'en');
  }

  // ==========================================
  // PREMIUM AUDIO-VISUAL GAMIFICATION UPGRADES
  // ==========================================

  // Synthesize popping C5-C6 double-sine chime
  function playPopChime() {
    if (localStorage.getItem('academyAudioMuted') === 'true') return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc1.type = 'sine';
      osc2.type = 'sine';
      
      // Dynamic frequency scaling for pop pop effect
      osc1.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc1.frequency.exponentialRampToValueAtTime(1046.50, ctx.currentTime + 0.12); // C6
      
      osc2.frequency.setValueAtTime(659.25, ctx.currentTime); // E5
      osc2.frequency.exponentialRampToValueAtTime(1318.51, ctx.currentTime + 0.15); // E6
      
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.005, ctx.currentTime + 0.3);
      
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);
      
      osc1.start();
      osc2.start();
      osc1.stop(ctx.currentTime + 0.3);
      osc2.stop(ctx.currentTime + 0.3);
    } catch (e) {
      console.warn("Audio Context playback blocked:", e);
    }
  }

  // Card-specific localized particle burst engine
  function triggerCardConfetti(parentEl) {
    if (!parentEl) return;
    const rect = parentEl.getBoundingClientRect();
    
    const canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '999999';
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.scale(dpr, dpr);

    const colors = ['#E98300', '#244C5A', '#FBBF24', '#10B981', '#3B82F6', '#EF4444'];
    const particles = [];

    // Calculate center coordinates of parent element
    const startX = rect.left + rect.width / 2;
    const startY = rect.top + rect.height / 2;

    // Spawn 45 color-rect particles
    for (let i = 0; i < 45; i++) {
      particles.push({
        x: startX,
        y: startY,
        vx: (Math.random() - 0.5) * 9,
        vy: (Math.random() - 0.5) * 9 - 2.5,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: Math.random() * 4 + 3,
        rotation: Math.random() * 360,
        spin: Math.random() * 8 - 4,
        opacity: 1
      });
    }

    function animate() {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      let alive = false;
      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.25; // gravity
        p.vx *= 0.98; // drag
        p.rotation += p.spin;
        p.opacity -= 0.016;

        if (p.opacity > 0) {
          alive = true;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate((p.rotation * Math.PI) / 180);
          ctx.globalAlpha = p.opacity;
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.5);
          ctx.restore();
        }
      });

      if (alive) {
        requestAnimationFrame(animate);
      } else {
        canvas.remove();
      }
    }
    animate();
  }

  // Render streak multiplier badge dynamically inside XP header container
  function renderStreakBadge() {
    const xpDisplay = document.getElementById('academy-xp-display');
    if (!xpDisplay) return;

    // Clear old badge
    const oldBadge = xpDisplay.querySelector('.xp-streak-multiplier-badge');
    if (oldBadge) oldBadge.remove();

    const streak = parseInt(sessionStorage.getItem('lessonStreak')) || 0;
    if (streak >= 2) {
      const badge = document.createElement('span');
      badge.className = 'xp-streak-multiplier-badge';
      badge.innerHTML = `🔥 ${streak}x STREAK`;
      badge.title = `${streak} lessons completed consecutively!`;
      xpDisplay.appendChild(badge);
    }
  }

  // Audio mute button controller setup
  function setupMuteAudioController() {
    const toggleBtn = document.getElementById('audio-mute-toggle');
    if (!toggleBtn) return;

    // Check saved state
    const isMuted = localStorage.getItem('academyAudioMuted') === 'true';
    toggleBtn.textContent = isMuted ? '🔇' : '🔊';
    toggleBtn.title = isMuted ? 'Unmute reward audio' : 'Mute reward audio';

    toggleBtn.addEventListener('click', () => {
      const currentlyMuted = localStorage.getItem('academyAudioMuted') === 'true';
      localStorage.setItem('academyAudioMuted', (!currentlyMuted).toString());
      toggleBtn.textContent = currentlyMuted ? '🔊' : '🔇';
      toggleBtn.title = currentlyMuted ? 'Mute reward audio' : 'Unmute reward audio';
    });
  }

  // --- Rotating Tips / Did You Know Widget ---
  function initializeDidYouKnowFacts() {
    const DID_YOU_KNOW_FACTS = {
      en: [
        "TE Connectivity has over 80,000 employees globally and operates in over 140 countries!",
        "TE Connectivity manufactures over 220 billion products annually, connecting data, power, and signal.",
        "Our integration process is structured into four pillars: Communication, Culture, Roles, and Onboarding to ensure synergy.",
        "The name 'TE Connectivity' stands for Tyco Electronics, which became a separate public company in 2007.",
        "TE Connectivity holds more than 15,000 global patents, driving innovation in automotive, aerospace, and medical fields."
      ],
      de: [
        "TE Connectivity hat weltweit über 80.000 Mitarbeiter und ist in mehr als 140 Ländern tätig!",
        "TE Connectivity stellt jährlich über 220 Milliarden Produkte her und verbindet Daten, Strom und Signale.",
        "Unser Integrationsprozess ist in vier Säulen gegliedert: Kommunikation, Kultur, Rollen und Onboarding, um Synergien zu sichern.",
        "Der Name „TE Connectivity“ steht für Tyco Electronics, das 2007 zu einem eigenständigen börsennotierten Unternehmen wurde.",
        "TE Connectivity hält weltweit mehr als 15.000 Patente und treibt Innovationen in den Bereichen Automobil, Luft- und Raumfahrt sowie Medizin voran."
      ],
      zh: [
        "TE Connectivity 在全球拥有超过 80,000 名员工，业务遍及 140 多个国家！",
        "TE Connectivity 每年生产超过 2,200 亿件产品，连接数据、电力和信号。",
        "我们的整合流程分为四大支柱：沟通、文化、角色和入职培训，以确保协同效应。",
        "“TE Connectivity”这个名字代表 Tyco Electronics，它于 2007 年成为一家独立的上市公司。",
        "TE Connectivity 拥有超过 15,000 项全球专利，推动汽车、航空航天和医疗领域的创新。"
      ],
      cs: [
        "TE Connectivity má celosvětově více než 80 000 zaměstnanců a působí ve více než 140 zemích!",
        "TE Connectivity vyrábí ročně přes 220 miliard produktů, které propojují data, energii a signál.",
        "Náš integrační proces je rozdělen do čtyř pilířů: Komunikace, Kultura, Role a Onboarding pro zajištění synergie.",
        "Název „TE Connectivity“ znamená Tyco Electronics, která se v roce 2007 stala samostatnou veřejně obchodovanou společností.",
        "TE Connectivity vlastní více než 15 000 globálních patentů a podporuje inovace v automobilovém, leteckém a zdravotnickém odvětví."
      ]
    };

    function factsForLang() {
      const lang = localStorage.getItem('employeeLanguage') || 'en';
      return DID_YOU_KNOW_FACTS[lang] || DID_YOU_KNOW_FACTS.en;
    }

    let currentFactIndex = 0;
    const factNextBtn = document.getElementById('did-you-know-next-btn');

    function renderCurrentFact() {
      const el = document.getElementById('did-you-know-text');
      if (!el) return;
      const facts = factsForLang();
      el.textContent = facts[currentFactIndex % facts.length];
    }

    function rotateFact() {
      const el = document.getElementById('did-you-know-text');
      if (!el) return;
      el.style.opacity = '0';
      setTimeout(() => {
        const facts = factsForLang();
        currentFactIndex = (currentFactIndex + 1) % facts.length;
        el.textContent = facts[currentFactIndex];
        el.style.opacity = '1';
      }, 200);
    }

    if (factNextBtn) {
      factNextBtn.addEventListener('click', rotateFact);
    }

    // Set initial fact
    renderCurrentFact();

    // Auto rotate every 15 seconds
    setInterval(rotateFact, 15000);

    // Expose so the language switcher can re-render the current fact in the new language
    window.__renderDidYouKnowFact = renderCurrentFact;
  }

  // Bind audio controller and render streak badge on startup
  setTimeout(() => {
    setupMuteAudioController();
    renderStreakBadge();
    initializeDidYouKnowFacts();
  }, 100);

  // Expose gamification API globally for check listeners
  window.playPopChime = playPopChime;
  window.triggerCardConfetti = triggerCardConfetti;
  window.renderStreakBadge = renderStreakBadge;

});
