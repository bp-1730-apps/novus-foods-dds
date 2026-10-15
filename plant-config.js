window.PLANT_CONFIG = {
  "_help": "Everything specific to ONE plant lives in this file. Keep it valid JSON (quoted keys, no comments, no trailing commas). The first line must stay exactly 'window.PLANT_CONFIG = '. Setup guide: PLANT_SETUP.md",
  "plant": {
    "id": "1730",
    "name": "Novus Foods Plant 1730",
    "shortLabel": "Plant 1730",
    "location": "Buena Park, CA",
    "contact": "Albert Mendoza",
    "org": "Novus Foods",
    "logo": "novus-logo.png",
    "logoWhite": "novus-logo-white.png"
  },
  "branding": {
    "showProductStrip": true,
    "showBrandsBar": true,
    "heroTag": "Made with Fresh Tomatoes · Plant 1730",
    "tiles": [
      { "name": "fresh cravings",    "category": "Salsa & Dips",     "color": "rgba(43,181,160,.25)" },
      { "name": "La Mexicana",       "category": "Tortillas",        "color": "rgba(218,30,117,.25)" },
      { "name": "noosa",             "category": "Yoghurt",          "color": "rgba(201,168,0,.25)" },
      { "name": "Señor Rico",        "category": "Hispanic Foods",   "color": "rgba(244,123,32,.25)" },
      { "name": "Salads of the Sea", "category": "Premium Seafood",  "color": "rgba(26,91,166,.25)" }
    ]
  },
  "supabase": {
    "url": "https://dljeskmcdrdxozefqyqc.supabase.co",
    "anonKey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsamVza21jZHJkeG96ZWZxeXFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwNzM0MjQsImV4cCI6MjEwNzY0OTQyNH0.ltDTvhNieeQ_d5x9V-Xd20iLYfsUOv1VVYr1msBcWHY"
  },
  "lines": [
    { "code": "2A",   "label": "2A",   "l2lCode": "BP-LINE1" },
    { "code": "PL1",  "label": "PL1",  "l2lCode": "BP-LINE4" },
    { "code": "MP4",  "label": "MP4",  "l2lCode": "BP-LINE3" },
    { "code": "PXM6", "label": "PXM6", "l2lCode": "BP-LINE2" },
    { "code": "PL2",  "label": "PL2",  "l2lCode": "BP-LINE5" },
    { "code": "2E",   "label": "2E",   "l2lCode": "BP-LINE6" }
  ],
  "cities": [
    { "name": "Buena Park", "display": "Buena Park (Overall)", "fillLabel": "Overall Fill Rate %" },
    { "name": "Cerritos",   "display": "Cerritos (Walmart)",   "fillLabel": "Walmart Fill Rate %" }
  ],
  "coreValues": [
    { "name": "1. Do the Right Thing",                  "desc": "Safety and quality always. Respect is nonnegotiable. Speak your truth." },
    { "name": "2. Our People Are Extraordinary",        "desc": "Passion, perseverance and humility (grit). Lead from any seat. Invest in yourself and others." },
    { "name": "3. Achieve More Together",               "desc": "Assume positive intent and build trust. Collaborate. Rally together in adversity." },
    { "name": "4. Be an Owner",                         "desc": "Take initiative. Be accountable. Leave it better than you found it." },
    { "name": "5. Customer Obsessed, Consumer Driven",  "desc": "Act with urgency. Deliver solutions, be opportunistic. Insights to action. See around corners." },
    { "name": "6. Relentless Growth",                   "desc": "Set ambitious goals. Stay hungry and embrace new challenges. Celebrate the wins." }
  ],
  "sources": {
    "dataEntry":      { "enabled": true },
    "powerAutomate":  { "enabled": true, "dataUrl": "dashboard-data.json" },
    "l2l": {
      "enabled": true,
      "dataUrl": "l2l-data.json",
      "company": "lakeviewfarms",
      "siteNumber": 2,
      "codeRedId": 205,
      "codeYellowId": 206
    },
    "sharepoint": {
      "enabled": true,
      "clientId": "319eaae5-9137-4b50-a1eb-ffb52ca93401",
      "tenantId": "56b8cda7-546e-49b1-ab41-957d6fafacdd",
      "fileOwner": "amendoza@novusfoods.com",
      "fileId": "D3AF0567-1205-48C6-A348-B8FA24C08639",
      "sharingUrl": "https://lakeviewfarms1600-my.sharepoint.com/:x:/g/personal/amendoza_novusfoods_com/IQD4Vi14LkrpTplzH4SRd6lgAYSebOn-eSMaiIn4y_cnBW4?e=RiDTRf"
    },
    "redzone": { "enabled": false }
  },
  "features": {
    "weeklyKpis": true
  },
  "weeklyKpis": {
    "_help": "Weekly KPIs are worked out from the daily numbers above. 'kpis' is the list you want to see first; 'autoDiscover' also adds every other numeric column found in Data Entry / L2L / the data file. Admins can rename, hide, re-roll-up and add KPIs on the Weekly KPIs page (Settings > Manage KPIs). rollup: sum | avg | last | min | max | count. unit: num | count | usd | pct_frac (0-1) | pct_pts (0-100). better: up | down.",
    "weekEndsOn": "sunday",
    "weeks": 52,
    "autoDiscover": true,
    "includeCurrentWeek": false,
    "kpis": [
      { "name": "OEE",              "section": "Production", "group": "Efficiency", "sheet": "Production",  "field": "OEE",             "rollup": "avg",  "unit": "pct_frac", "better": "up" },
      { "name": "Attainment",       "section": "Production", "group": "Efficiency", "sheet": "Production",  "field": "Attainment",      "rollup": "avg",  "unit": "pct_frac", "better": "up" },
      { "name": "Downtime (min)",   "section": "Production", "group": "Efficiency", "sheet": "Production",  "field": "Downtime",        "rollup": "sum",  "unit": "num",      "better": "down" },
      { "name": "Pounds Planned",   "section": "Production", "group": "Output",     "sheet": "Production",  "field": "Expected Pounds", "rollup": "sum",  "unit": "num" },
      { "name": "Pounds Produced",  "section": "Production", "group": "Output",     "sheet": "Production",  "field": "Actual Pounds",   "rollup": "sum",  "unit": "num",      "better": "up" },
      { "name": "Code Red",         "section": "Maintenance", "group": "Work orders", "sheet": "Maintenance", "field": "Code Red",       "rollup": "last", "unit": "count",    "better": "down", "breakdown": false },
      { "name": "Code Yellow",      "section": "Maintenance", "group": "Work orders", "sheet": "Maintenance", "field": "Code Yellow",    "rollup": "last", "unit": "count",    "better": "down", "breakdown": false }
    ]
  }
};

/* Compatibility shim: older page code asks for a list of plants. A deployment
   is exactly one plant, so the "list" always has one entry. */
(function () {
  var c = window.PLANT_CONFIG, p = c.plant;
  var legacy = {
    id: p.id, name: p.name, shortLabel: p.shortLabel, location: p.location,
    dataUrl: c.sources.powerAutomate.enabled ? c.sources.powerAutomate.dataUrl : '',
    l2lDataUrl: c.sources.l2l.enabled ? c.sources.l2l.dataUrl : '',
    lines: c.lines.map(function (l) { return l.code; })
  };
  window.PLANTS_CONFIG_PROMISE = Promise.resolve({ plants: [legacy] });
})();
