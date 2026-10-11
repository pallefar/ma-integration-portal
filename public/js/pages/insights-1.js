// Externalised from the inline block of insights.html (SAFE-02 / D-13-03, plan 13-10) - moved verbatim, same position.
(function () {
    // --- Data -------------------------------------------------------------
    var CURRENT = {
      name:"NextGen Sensors Ltd.", ticker:"Private · Active target", sector:"MEMS & smart sensors",
      hq:"Cambridge, United Kingdom", founded:"2011", employees:"~850", revenue:"$180M est.", fitScore:91,
      status:"Acquisition in progress · Day 1–100 integration",
      overview:"Designs and manufactures MEMS-based smart pressure, position and environmental sensors for automotive, industrial-automation and medical-device OEMs.",
      strategicFit:"The acquisition TE is integrating now. NextGen's MEMS sensing IP and automotive design wins accelerate TE's Sensor Solutions roadmap and strengthen its position in EV and industrial automation. Integration is underway across the first 100 days — the focus of this portal.",
      synergies:["Fold MEMS sensing IP into TE Sensor Solutions","Cross-sell into shared automotive & industrial OEMs","Combine sensing with TE interconnect into integrated modules","Scale NextGen products on TE's global manufacturing footprint"],
      risks:["Retention of key R&D / sensing engineers","PLM & systems migration timeline","Culture integration across UK and TE sites"],
      keyProducts:["MEMS pressure sensors","Position / speed sensors","Environmental & gas sensors","Sensor signal-conditioning ASICs"],
      fitRationale:"Direct strategic fit — sensing IP and automotive design wins in TE's fastest-growing vector."
    };
    var TARGETS = [{"name":"Sensata Technologies","ticker":"NYSE: ST","sector":"Automotive & industrial sensors","hq":"Attleboro, Massachusetts, USA","founded":"1916","employees":"~19,000","revenue":"$3.9B (FY2024)","overview":"Global industrial-technology company making pressure, temperature, position and electrical-protection sensors for mission-critical automotive, heavy-vehicle and industrial systems, plus EV battery-management and high-voltage power distribution.","strategicFit":"Sensing is TE’s fastest-growing franchise; Sensata would roughly double TE’s sensor scale and deepen its EV electrification position (battery management, HV distribution). Heavy overlap with TE Transportation and Industrial segments makes it a natural, if large, bolt-on to TE Sensor Solutions.","synergies":["Fuse sensing + interconnect into integrated modules","Cross-sell across shared automotive/industrial OEMs","Scale EV battery-management and HV power content","Consolidate global manufacturing and procurement"],"risks":["Large deal (~$5-7B est.): financing and dilution","Sensor product overlap needing rationalization","Automotive-sensing antitrust scrutiny"],"keyProducts":["Pressure & temperature sensors","Position/speed sensors","EV battery-management systems","High-voltage distribution units"],"fitScore":88,"fitRationale":"Doubles down on sensing, TE’s top growth vector, with strong EV overlap, though large and pricey."},{"name":"Novanta Inc.","ticker":"NASDAQ: NOVT","sector":"Photonics & medical technology","hq":"Bedford, Massachusetts, USA","founded":"1968","employees":"~4,000 est.","revenue":"$949M (FY2024)","overview":"Supplier of photonics (lasers, optical scanning, beam delivery), precision-motion, and medical subsystems embedded inside medical and advanced-industrial equipment.","strategicFit":"Adds optical/photonics and medical-device subsystem content that TE’s Medical and Data & Devices units lack organically. Strengthens TE in minimally-invasive surgery, robotics and laser-based industrial systems while adding high-margin OEM revenue.","synergies":["Bundle photonic engines with TE medical interconnect","Push TE Medical into surgical robotics and lasers","Cross-sell precision motion to automation base","Add high-margin recurring OEM subsystem revenue"],"risks":["Premium high-multiple med-tech valuation","Subsystem vs component business-model gap","Little automotive/transportation overlap"],"keyProducts":["Medical lasers & photonics","Optical encoders / precision motion","Beam-steering & scanning","Medical insufflators/subsystems"],"fitScore":82,"fitRationale":"High-margin entry into photonics and medical subsystems that complement rather than overlap TE’s core."},{"name":"Methode Electronics","ticker":"NYSE: MEI","sector":"EV power distribution & user interface","hq":"Chicago, Illinois, USA","founded":"1946","employees":"~5,500 est.","revenue":"$1.1B (FY2024)","overview":"Custom-engineered mechatronics maker of power-distribution (busbars/BMS), user-interface, LED-lighting and sensor products for automotive, EV and industrial OEMs.","strategicFit":"Directly reinforces TE’s Automotive/EV franchise with high-voltage busbars and power-distribution content riding the same electrification wave as TE connectors. Adds user-interface and sensing adjacencies to TE Transportation Solutions.","synergies":["Pair busbars/power distribution with TE HV connectors","Leverage shared automotive/EV OEM relationships","Cross-sell sensing and user-interface content","Combine low-cost manufacturing footprints"],"risks":["EV program roll-offs and demand softness","Customer concentration in autos","Overlap in some connector/sensor lines"],"keyProducts":["EV busbars & power distribution","Sensors & switches","LED lighting systems","User-interface / mechatronics"],"fitScore":84,"fitRationale":"Clean EV-electrification adjacency to TE’s core auto connectors, though cyclical and auto-concentrated."},{"name":"TT Electronics plc","ticker":"LSE: TTG","sector":"Harsh-environment sensors & power","hq":"Woking, United Kingdom","founded":"1906","employees":"~5,000","revenue":"~$660M (FY2024)","overview":"UK-based designer and manufacturer of sensors, power-management and connectivity components plus value-added electronics for aerospace & defense, medical and industrial harsh-environment applications.","strategicFit":"Strengthens TE’s Aerospace, Defense & Marine and Industrial segments with radiation- and corrosion-tolerant sensors and power electronics. Adds a European A&D footprint and engineered-EMS capability adjacent to TE’s ruggedized interconnect.","synergies":["Bundle harsh-env sensors with TE ruggedized connectors","Expand A&D/medical content and EU footprint","Cross-sell power electronics into industrial base","Add value-added EMS and design services"],"risks":["Cross-border UK defense/regulatory review","Lower-margin EMS mix to rationalize","FX and integration complexity"],"keyProducts":["Precision resistors & sensors","Optoelectronics","Harsh-env power conversion/control","Engineered EMS assemblies"],"fitScore":79,"fitRationale":"Solid A&D/industrial harsh-environment fit and EU reach, tempered by EMS margins and cross-border review."},{"name":"ChargePoint Holdings","ticker":"NYSE: CHPT","sector":"EV charging infrastructure","hq":"Campbell, California, USA","founded":"2007","employees":"~1,500 est.","revenue":"$417M (FY2025)","overview":"Operator of one of the largest networked EV-charging platforms, combining AC/DC charging hardware, cloud subscription software and a network of 1.3M+ ports.","strategicFit":"Extends TE downstream from EV vehicle connectors into charging infrastructure, where TE already supplies inlets, cables and high-power connectors. Fits TE’s electrification and sustainability thesis and adds recurring software revenue.","synergies":["Supply TE HV connectors/inlets into ChargePoint hardware","Own the EV story from vehicle to charger","Add recurring charging-software revenue","Use TE manufacturing to cut charger cost"],"risks":["Unprofitable, cash-burning, volatile","Software/network model far from TE’s component core","EV-adoption and policy sensitivity"],"keyProducts":["AC/DC EV chargers","Charging-network software","Fleet/depot charging","Charging-management SaaS"],"fitScore":66,"fitRationale":"Compelling EV narrative and downstream pull for TE connectors, but off-core model and weak financials."},{"name":"Bel Fuse Inc.","ticker":"NASDAQ: BELFB","sector":"Interconnect, magnetics & power","hq":"West Windsor, New Jersey, USA","founded":"1949","employees":"~8,000 est.","revenue":"$535M (FY2024)","overview":"Global maker of products that power, protect and connect circuits, spanning expanded-beam fiber and RF/copper connectors (Cinch), magnetics, circuit protection and power conversion.","strategicFit":"Direct bolt-on to TE’s interconnect and Data & Devices businesses, adding high-reliability aerospace/defense connectors (Cinch), fiber-optic and RF interconnect, plus power conversion and circuit protection. Broadens TE’s data-center and A&D content.","synergies":["Fold Cinch A&D connectors into TE ruggedized portfolio","Add fiber/RF interconnect for data centers","Cross-sell magnetics and power modules","Consolidate distribution channels"],"risks":["Heavy product overlap with TE connectors","Interconnect antitrust review","Dual-class (BELFA/BELFB) ownership structure"],"keyProducts":["Cinch high-reliability connectors","Expanded-beam fiber & RF connectors","Magnetics / ICM modules","Power conversion & circuit protection"],"fitScore":74,"fitRationale":"Clean interconnect/power bolt-on with A&D and data-center content, but overlaps TE’s own connectors."}];

    // --- Render -----------------------------------------------------------
    function scoreColor(s){ return s>=85?'#3f7a37':(s>=75?'#167987':(s>=65?'#C77700':'#8a8f92')); }
    function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
    function list(arr,cls){ return '<ul class="ins-list '+cls+'">'+(arr||[]).map(function(x){return '<li>'+esc(x)+'</li>';}).join('')+'</ul>'; }
    function renderInsight(c){
      var col=scoreColor(c.fitScore);
      return ''
        + '<div class="ins-detail">'
        + '<div class="ins-top"><div><h2 class="ins-name">'+esc(c.name)+'</h2>'
        +   '<div class="ins-tags"><span class="ins-chip tick">'+esc(c.ticker)+'</span><span class="ins-chip">'+esc(c.sector)+'</span>'
        +   (c.status?'<span class="ins-chip" style="background:rgba(233,131,0,.1); color:#C77700; border-color:rgba(233,131,0,.3);">'+esc(c.status)+'</span>':'')+'</div></div>'
        +   '<div class="ins-score"><div class="ins-score-ring" style="background:'+col+'">'+c.fitScore+'</div><div class="ins-score-lbl">Fit score</div></div></div>'
        + '<div class="ins-meta">'
        +   '<div class="m"><div class="k">HQ</div><div class="v">'+esc(c.hq)+'</div></div>'
        +   '<div class="m"><div class="k">Founded</div><div class="v">'+esc(c.founded)+'</div></div>'
        +   '<div class="m"><div class="k">Employees</div><div class="v">'+esc(c.employees)+'</div></div>'
        +   '<div class="m"><div class="k">Revenue</div><div class="v">'+esc(c.revenue)+'</div></div>'
        + '</div>'
        + '<div class="ins-sec"><h4>Overview</h4><p>'+esc(c.overview)+'</p></div>'
        + '<div class="ins-sec"><h4>Strategic fit for TE</h4><p>'+esc(c.strategicFit)+'</p></div>'
        + '<div class="ins-cols"><div class="ins-sec"><h4>Synergies</h4>'+list(c.synergies,'syn')+'</div>'
        +   '<div class="ins-sec"><h4>Risks &amp; considerations</h4>'+list(c.risks,'risk')+'</div></div>'
        + '<div class="ins-sec"><h4>Key products &amp; tech</h4><div class="ins-prods">'+(c.keyProducts||[]).map(function(p){return '<span class="ins-prod">'+esc(p)+'</span>';}).join('')+'</div></div>'
        + (c.fitRationale?'<div class="ins-sec" style="margin-bottom:0;"><h4>Why this score</h4><p><strong style="color:'+col+'">'+c.fitScore+'/100</strong> — '+esc(c.fitRationale)+'</p></div>':'')
        + '</div>';
    }

    document.getElementById('ins-current').innerHTML = renderInsight(CURRENT);

    var grid=document.getElementById('ins-radar-grid');
    grid.innerHTML = TARGETS.map(function(c,i){
      var col=scoreColor(c.fitScore);
      return '<button class="ins-co-card" data-i="'+i+'" style="--sc:'+col+'; border-top-color:'+col+'">'
        + '<div class="ins-co-head"><div><div class="ins-co-name">'+esc(c.name)+'</div><div class="ins-co-sector">'+esc(c.ticker)+' · '+esc(c.sector)+'</div></div>'
        +   '<div class="ins-co-score" style="background:'+col+'">'+c.fitScore+'</div></div>'
        + '<div class="ins-co-ov">'+esc(c.overview)+'</div>'
        + '<div class="ins-co-foot"><span>'+esc(c.hq)+'</span><span class="open">View insight →</span></div>'
        + '</button>';
    }).join('');

    // --- Interactions -----------------------------------------------------
    var modal=document.getElementById('ins-modal'), modalBody=document.getElementById('ins-modal-body');
    function openModal(c){ modalBody.innerHTML=renderInsight(c); modal.style.display='flex'; document.body.style.overflow='hidden'; }
    function closeModal(){ modal.style.display='none'; document.body.style.overflow=''; }
    grid.addEventListener('click', function(e){ var b=e.target.closest('.ins-co-card'); if(b) openModal(TARGETS[+b.getAttribute('data-i')]); });
    document.getElementById('ins-modal-close').addEventListener('click', closeModal);
    modal.addEventListener('click', function(e){ if(e.target===modal) closeModal(); });
    document.addEventListener('keydown', function(e){ if(e.key==='Escape' && modal.style.display==='flex') closeModal(); });

    document.querySelectorAll('.ins-tab').forEach(function(t){
      t.addEventListener('click', function(){
        document.querySelectorAll('.ins-tab').forEach(function(x){x.classList.remove('active');});
        t.classList.add('active');
        var which=t.getAttribute('data-ins-tab');
        document.getElementById('ins-current').style.display = which==='current'?'block':'none';
        document.getElementById('ins-radar').style.display = which==='radar'?'block':'none';
      });
    });

    // Grid / list view toggle for the Acquisition Radar
    (function(){
      var grid=document.getElementById('ins-radar-grid'), saved=null;
      try{ saved=localStorage.getItem('ins_radar_view'); }catch(e){}
      function apply(v){
        grid.classList.toggle('list', v==='list');
        document.querySelectorAll('.ins-vbtn').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-view')===v); });
        try{ localStorage.setItem('ins_radar_view', v); }catch(e){}
      }
      document.querySelectorAll('.ins-vbtn').forEach(function(b){ b.addEventListener('click', function(){ apply(b.getAttribute('data-view')); }); });
      if(saved==='list') apply('list');
    })();
})();
