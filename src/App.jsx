import { useState, useEffect, useRef, useCallback } from "react";

// ─── Persistence ──────────────────────────────────────────────────────────────
const SK = "tangent_brain_v5";
function load() { try { const r = localStorage.getItem(SK); return r ? JSON.parse(r) : {}; } catch { return {}; } }
function save(d) { try { localStorage.setItem(SK, JSON.stringify(d)); } catch {} }


// ─── Palette ──────────────────────────────────────────────────────────────────
const PALETTE = ["#f87171","#fb923c","#fbbf24","#a3e635","#34d399","#22d3ee",
                 "#60a5fa","#a78bfa","#f472b6","#e879f9","#4ade80","#38bdf8",
                 "#facc15","#c084fc","#fb7185"];
const SCOUT_COLORS = {
  Stats:"#38bdf8", Business:"#fbbf24", Coaching:"#34d399",
  "Laws & Policy":"#f472b6", Rankings:"#a78bfa", Recruitment:"#fb923c",
  Community:"#4ade80", Technology:"#e879f9", Health:"#f87171", Other:"#94a3b8"
};
const QC_COLOR = "#f97316";

// ─── Gemini API helpers ───────────────────────────────────────────────────────

// Standard generation — no search
async function gemini(systemPrompt, userPrompt, maxTokens = 1500) {
  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gemini-2.0-flash",
      payload: {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4 }
      }
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function geminiSearch(systemPrompt, userPrompt, maxTokens = 2000) {
  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gemini-2.0-flash",
      payload: {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 }
      }
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.filter(p => p.text).map(p => p.text).join("\n") || "";
}

// JSON-only wrapper — strips markdown fences and parses
async function geminiJSON(systemPrompt, userPrompt, maxTokens = 1200) {
  const raw = await gemini(
    systemPrompt + "\n\nCRITICAL: Respond with ONLY valid raw JSON. No markdown fences, no backticks, no explanation, no preamble.",
    userPrompt,
    maxTokens
  );
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function ago(ts) {
  const d = Date.now() - ts;
  if (d < 60000)    return "just now";
  if (d < 3600000)  return `${Math.floor(d/60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d/3600000)}h ago`;
  return `${Math.floor(d/86400000)}d ago`;
}
function fmt(n) { return typeof n === "number" ? n.toLocaleString() : n; }
function getClusterColor(i) { return PALETTE[i % PALETTE.length]; }

// ─── QC severity map ──────────────────────────────────────────────────────────
const SEV = {
  pass: { color:"#34d399", bg:"rgba(52,211,153,0.1)",  border:"rgba(52,211,153,0.25)",  label:"PASS", icon:"✓" },
  warn: { color:"#fbbf24", bg:"rgba(251,191,36,0.1)",  border:"rgba(251,191,36,0.25)",  label:"WARN", icon:"⚠" },
  flag: { color:QC_COLOR,  bg:"rgba(249,115,22,0.1)",  border:"rgba(249,115,22,0.25)",  label:"FLAG", icon:"⚑" },
  fail: { color:"#f87171", bg:"rgba(248,113,113,0.1)", border:"rgba(248,113,113,0.25)", label:"FAIL", icon:"✕" },
};

// ─── UI primitives ────────────────────────────────────────────────────────────
function Pip({ status, color="#60a5fa" }) {
  const bg = status==="done" ? color : status==="running" ? "#fbbf24" : "rgba(255,255,255,0.08)";
  return <div style={{ width:7, height:7, borderRadius:"50%", flexShrink:0, transition:"all 0.4s",
    background:bg,
    boxShadow: status==="running"?"0 0 6px #fbbf24":status==="done"?`0 0 5px ${color}`:"none",
    animation: status==="running"?"pp 1s infinite":"none" }} />;
}

function Badge({ label, color, small }) {
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5,
      padding: small?"2px 7px":"3px 10px", borderRadius:20,
      background:`${color}18`, border:`1px solid ${color}35`,
      color, fontSize:small?10:11, fontFamily:"'Syne Mono',monospace", whiteSpace:"nowrap" }}>
      <span style={{fontSize:7}}>●</span>{label}
    </span>
  );
}

function Panel({ children, style={} }) {
  return <div style={{ background:"rgba(255,255,255,0.025)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:14, ...style }}>{children}</div>;
}

function SectionLabel({ children, color="#2a3347" }) {
  return <div style={{ fontSize:10, color, fontFamily:"'Syne Mono',monospace", letterSpacing:"0.1em", marginBottom:14 }}>{children}</div>;
}

function StatCard({ label, value, unit, color }) {
  return (
    <div style={{ background:`${color}0d`, border:`1px solid ${color}22`, borderRadius:12, padding:"16px 18px" }}>
      <div style={{ fontSize:10, color:"#3d4a63", fontFamily:"'Syne Mono',monospace", marginBottom:8 }}>{label}</div>
      <div style={{ fontSize:26, fontWeight:800, fontFamily:"'Syne',sans-serif", color, lineHeight:1 }}>
        {fmt(value)}<span style={{ fontSize:12, fontWeight:400, marginLeft:4, color:`${color}88` }}>{unit}</span>
      </div>
    </div>
  );
}

function ConfidenceBar({ score }) {
  const pct = Math.round((score||0) * 100);
  const c = score >= 0.8 ? "#34d399" : score >= 0.6 ? "#fbbf24" : "#f87171";
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
      <div style={{ flex:1, height:4, background:"rgba(255,255,255,0.05)", borderRadius:2, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${pct}%`, background:c, boxShadow:`0 0 5px ${c}`, transition:"width 0.8s ease", borderRadius:2 }} />
      </div>
      <span style={{ fontSize:10, color:c, fontFamily:"'Syne Mono',monospace", minWidth:30 }}>{pct}%</span>
    </div>
  );
}

function QCBadge({ severity }) {
  const s = SEV[severity] || SEV.warn;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"2px 8px", borderRadius:12,
      background:s.bg, border:`1px solid ${s.border}`, color:s.color, fontSize:9, fontFamily:"'Syne Mono',monospace" }}>
      {s.icon} {s.label}
    </span>
  );
}

function AgentPill({ label, running, color }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:5, padding:"3px 9px", borderRadius:20,
      background: running?`${color}15`:"rgba(255,255,255,0.025)",
      border:`1px solid ${running?`${color}35`:"rgba(255,255,255,0.05)"}`,
      fontSize:9, fontFamily:"'Syne Mono',monospace", color:running?color:"#1e2a3a", transition:"all 0.4s" }}>
      <div style={{ width:4, height:4, borderRadius:"50%", background:running?color:"#1e2640", animation:running?"pp 1s infinite":"none" }} />
      {label}
    </div>
  );
}

function Spinner({ color }) {
  return <div style={{ width:10, height:10, borderRadius:"50%", border:`2px solid ${color}`, borderTopColor:"transparent", animation:"spin 0.8s linear infinite" }} />;
}



// ─── Main App ─────────────────────────────────────────────────────────────────
export default function TangentBrain() {
  const [tab, setTab]                     = useState("capture");
  const [thoughts, setThoughts]           = useState([]);
  const [clusters, setClusters]           = useState([]);
  const [scoutArticles, setScoutArticles] = useState([]);
  const [scoutRunning, setScoutRunning]   = useState(false);
  const [scoutLastRun, setScoutLastRun]   = useState(null);
  const [scoutFilter, setScoutFilter]     = useState("All");
  const [digestEntries, setDigestEntries] = useState([]);
  const [statsDb, setStatsDb]             = useState([]);
  const [digestRunning, setDigestRunning] = useState(false);
  const [digestLastRun, setDigestLastRun] = useState(null);
  const [qcReports, setQcReports]         = useState([]);
  const [qcGlobal, setQcGlobal]           = useState(null);
  const [qcRunning, setQcRunning]         = useState(false);
  const [qcLastRun, setQcLastRun]         = useState(null);
  const [selectedId, setSelectedId]       = useState(null);
  const [expandedQcId, setExpandedQcId]   = useState(null);
  const [input, setInput]                 = useState("");
  const [capturing, setCapturing]         = useState(false);
  const [toast, setToast]                 = useState(null);

  // Refs so async agents always see latest state
  const tRef  = useRef(thoughts);
  const clRef = useRef(clusters);
  const scRef = useRef(scoutArticles);
  const stRef = useRef(statsDb);
  useEffect(() => { tRef.current  = thoughts;      }, [thoughts]);
  useEffect(() => { clRef.current = clusters;      }, [clusters]);
  useEffect(() => { scRef.current = scoutArticles; }, [scoutArticles]);
  useEffect(() => { stRef.current = statsDb;       }, [statsDb]);

  // ── Persistence load / save ────────────────────────────────────────────────
  useEffect(() => {
    const s = load();
    if (s.thoughts)      setThoughts(s.thoughts);
    if (s.clusters)      setClusters(s.clusters);
    if (s.scoutArticles) setScoutArticles(s.scoutArticles);
    if (s.scoutLastRun)  setScoutLastRun(s.scoutLastRun);
    if (s.digestEntries) setDigestEntries(s.digestEntries);
    if (s.statsDb)       setStatsDb(s.statsDb);
    if (s.digestLastRun) setDigestLastRun(s.digestLastRun);
    if (s.qcReports)     setQcReports(s.qcReports);
    if (s.qcGlobal)      setQcGlobal(s.qcGlobal);
    if (s.qcLastRun)     setQcLastRun(s.qcLastRun);
  }, []);

  useEffect(() => {
    save({ thoughts, clusters, scoutArticles, scoutLastRun, digestEntries, statsDb, digestLastRun, qcReports, qcGlobal, qcLastRun });
  }, [thoughts, clusters, scoutArticles, scoutLastRun, digestEntries, statsDb, digestLastRun, qcReports, qcGlobal, qcLastRun]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const notify  = msg => { setToast({ msg }); setTimeout(() => setToast(null), 3500); };
  const updT    = useCallback((id, up) => setThoughts(p => p.map(t => t.id===id ? {...t,...up} : t)), []);
  const setAgt  = useCallback((id, ag, st) => setThoughts(p => p.map(t => t.id===id ? {...t, agentStatus:{...t.agentStatus,[ag]:st}} : t)), []);

  // Inject the live API key into every call
  function G(sys, usr, tok)        { return gemini(sys, usr, tok); }
  function GS(sys, usr, tok)       { return geminiSearch(sys, usr, tok); }
  function GJ(sys, usr, tok)       { return geminiJSON(sys, usr, tok); }

  // ── Agent 1: Classifier ────────────────────────────────────────────────────
  async function runClassifier(id, raw) {
    setAgt(id, "classify", "running");
    try {
      const existing = clRef.current.map(c=>`ID:${c.id}|Name:"${c.name}"|Topics:${c.exampleTopics}`).join("\n") || "None";
      const p = await GJ(
        "You are a semantic clustering agent for a personal thought-capture system. The user captures spontaneous thoughts while driving and listening to podcasts.",
        `Existing clusters:\n${existing}\n\nNew thought: "${raw}"\n\nRules: Match if genuinely same domain. Cluster names must be personal and specific (e.g. "Youth Basketball Coaching", "MarketMap Business"). Only create a new cluster if this is truly a different domain.\n\nRespond with ONLY this JSON:\n{"action":"match or create","clusterId":"existing id if match else empty","newClusterName":"name if creating","newClusterExampleTopics":"topic1,topic2","reasoning":"one sentence why"}`
      );
      let cid, cname;
      if (p.action === "match" && p.clusterId) {
        cid   = p.clusterId;
        cname = clRef.current.find(c=>c.id===cid)?.name || "Unknown";
        setClusters(prev => prev.map(c => c.id===cid ? {...c, thoughtCount:(c.thoughtCount||1)+1} : c));
        notify(`→ Matched to "${cname}"`);
      } else {
        const nid = `cl_${Date.now()}`;
        const nc  = { id:nid, name:p.newClusterName||"New Cluster", color:getClusterColor(clRef.current.length), createdAt:Date.now(), thoughtCount:1, exampleTopics:p.newClusterExampleTopics||"" };
        setClusters(prev => [...prev, nc]);
        cid = nid; cname = nc.name;
        notify(`✦ New cluster: "${cname}"`);
      }
      updT(id, { clusterId:cid, clusterName:cname, classifierReasoning:p.reasoning, classification:`Cluster: ${cname}\n\n${p.reasoning}` });
      setAgt(id, "classify", "done");
      return { cid, cname };
    } catch(e) { updT(id, { classification:"Error: "+e.message }); setAgt(id, "classify", "done"); return {}; }
  }

  // ── Agent 2: Researcher ────────────────────────────────────────────────────
  async function runResearcher(id, raw) {
    setAgt(id, "research", "running");
    try {
      const res = await G(
        "You are a personal knowledge research agent. The user captures quick thoughts while driving. Provide a rich but scannable research brief: key facts, context, notable figures or works, why it matters. Max 350 words.",
        `Thought captured: "${raw}"`
      );
      updT(id, { research:res });
    } catch(e) { updT(id, { research:"Research error: "+e.message }); }
    setAgt(id, "research", "done");
  }

  // ── Agent 3: Enricher ──────────────────────────────────────────────────────
  async function runEnricher(id, raw, cname) {
    setAgt(id, "enrich", "running");
    try {
      const ctx = clRef.current.map(c => {
        const ts = tRef.current.filter(t => t.id!==id && t.clusterId===c.id).map(t=>`  - "${t.raw}"`).join("\n");
        return ts ? `[${c.name}]\n${ts}` : null;
      }).filter(Boolean).join("\n\n");
      const res = await G(
        "You are a thought enrichment agent. Find meaningful cross-cluster connections, 2-3 angles the person hasn't considered, and one rabbit-hole question worth diving into. Be intellectually honest and specific. Max 300 words.",
        `New thought: "${raw}"\nAssigned cluster: ${cname||"?"}\n\nAll past thoughts by cluster:\n${ctx||"(this is their first thought)"}`
      );
      updT(id, { enrichment:res });
    } catch(e) { updT(id, { enrichment:"Enrichment error: "+e.message }); }
    setAgt(id, "enrich", "done");
  }

  // ── Agent 4: Synthesizer ───────────────────────────────────────────────────
  async function runSynthesizer(id, raw) {
    setAgt(id, "output", "running");
    try {
      const t   = tRef.current.find(x => x.id===id);
      const res = await G(
        "You are a synthesis agent producing a personal Thought Report. Use exactly these headers:\n## Core Insight\n## Why This Matters To You\n## Unexpected Angle\n## Action Items\n## Come Back To This When...\nBe direct, specific, and energizing. Max 280 words.",
        `Original thought: "${raw}"\nResearch: ${(t?.research||"").slice(0,400)}\nEnrichment notes: ${(t?.enrichment||"").slice(0,400)}`
      );
      updT(id, { synthesis:res });
    } catch(e) { updT(id, { synthesis:"Synthesis error: "+e.message }); }
    setAgt(id, "output", "done");
  }

  // ── Agent 7: QC — per thought ──────────────────────────────────────────────
  async function runQCOnThought(id) {
    setAgt(id, "qc", "running");
    try {
      const t          = tRef.current.find(x => x.id===id);
      const cluster    = clRef.current.find(c => c.id===t?.clusterId);
      const allClusters = clRef.current.map(c=>`"${c.name}" (${c.exampleTopics})`).join(", ");
      const parsed = await GJ(
        "You are a strict QC agent auditing a 4-agent thought-capture pipeline. Be specific and honest in your evaluation.",
        `ORIGINAL THOUGHT: "${t?.raw}"

AGENT OUTPUTS:
1. CLASSIFIER → Cluster: "${cluster?.name||"Unassigned"}" | Reasoning: "${t?.classifierReasoning||"none"}"
   All clusters available: ${allClusters||"none"}

2. RESEARCHER (first 400 chars): "${(t?.research||"").slice(0,400)}"

3. ENRICHER (first 400 chars): "${(t?.enrichment||"").slice(0,400)}"

4. SYNTHESIZER (first 400 chars): "${(t?.synthesis||"").slice(0,400)}"

Evaluate each agent on:
- accuracy (0.0-1.0): factually sound?
- relevance (0.0-1.0): addresses the actual thought?
- quality (0.0-1.0): coherent and useful?
- severity: pass | warn | flag | fail
- issues: array of specific problems (empty if none)
- suggestion: one improvement sentence, or empty string

Return this exact JSON:
{
  "thoughtId": "${id}",
  "overallScore": 0.0,
  "overallSeverity": "pass",
  "summary": "2-sentence assessment",
  "clusterCorrect": true,
  "clusterNote": "",
  "suggestedCluster": "",
  "agents": {
    "classifier": {"accuracy":0.9,"relevance":0.9,"quality":0.9,"severity":"pass","issues":[],"suggestion":""},
    "researcher":  {"accuracy":0.9,"relevance":0.9,"quality":0.9,"severity":"pass","issues":[],"suggestion":""},
    "enricher":   {"accuracy":0.9,"relevance":0.9,"quality":0.9,"severity":"pass","issues":[],"suggestion":""},
    "synthesizer":{"accuracy":0.9,"relevance":0.9,"quality":0.9,"severity":"pass","issues":[],"suggestion":""}
  },
  "checkedAt": ${Date.now()}
}`
      );
      setQcReports(prev => [parsed, ...prev.filter(r=>r.thoughtId!==id)]);
      updT(id, { qcScore:parsed.overallScore, qcSeverity:parsed.overallSeverity });
      setAgt(id, "qc", "done");
      notify(`QC — ${(parsed.overallSeverity||"done").toUpperCase()} (${Math.round((parsed.overallScore||0)*100)}%)`);
    } catch(e) { setAgt(id, "qc", "done"); notify("QC error: "+e.message); }
  }

  // ── Full pipeline ──────────────────────────────────────────────────────────
  async function runPipeline(thought) {
    const { cid, cname } = await runClassifier(thought.id, thought.raw);
    await Promise.all([runResearcher(thought.id, thought.raw), runEnricher(thought.id, thought.raw, cname)]);
    await runSynthesizer(thought.id, thought.raw);
    await runQCOnThought(thought.id);
  }

  async function capture() {
    if (!input.trim() || capturing) return;
    setCapturing(true);
    const t = {
      id:`t_${Date.now()}`, raw:input.trim(), timestamp:Date.now(),
      clusterId:null, clusterName:null, classifierReasoning:null,
      classification:null, research:null, enrichment:null, synthesis:null,
      qcScore:null, qcSeverity:null,
      agentStatus:{ classify:"idle", research:"idle", enrich:"idle", output:"idle", qc:"idle" }
    };
    setThoughts(p => [t,...p]);
    setSelectedId(t.id);
    setInput(""); setCapturing(false); setTab("thoughts");
    runPipeline(t);
  }

  // ── Agent 5: Scout (Google Search grounded) ────────────────────────────────
  async function runScout() {
    if (scoutRunning) return;
    setScoutRunning(true);
    notify("Scout searching the web via Google Search…");
    try {
      const raw = await GS(
        `You are a youth basketball intelligence scout agent. Use Google Search to find current news and information.
After searching, return ONLY a raw JSON array — no markdown, no explanation. Each item must have:
{"title":"","summary":"2-3 sentences","category":"Stats|Business|Coaching|Laws & Policy|Rankings|Recruitment|Community|Technology|Health|Other","keyStats":["stat string or empty array"],"source":"publication name","relevance":"local|national|international","date":"approximate date","url":""}
Find at least 8-10 distinct recent stories. Return ONLY the JSON array.`,
        "Search for the latest youth basketball news, stats, business developments, coaching strategies, laws or policies affecting youth sports, player rankings, and recruitment stories from the past 2 weeks. Include a variety of topics and sources."
      );
      let articles = [];
      try { const m = raw.match(/\[[\s\S]*?\]/s); articles = m ? JSON.parse(m[0]) : []; } catch { articles = []; }
      const stamped = articles.map((a,i) => ({...a, id:`art_${Date.now()}_${i}`, fetchedAt:Date.now()}));
      setScoutArticles(stamped);
      setScoutLastRun(Date.now());
      notify(`Scout found ${stamped.length} articles — auditing with QC…`);
      await runQCOnScout(stamped);
    } catch(e) { notify("Scout error: "+e.message); }
    setScoutRunning(false);
  }

  // ── Agent 6: Daily Digest (Google Search grounded) ────────────────────────
  async function runDigest() {
    if (digestRunning) return;
    setDigestRunning(true);
    notify("Digest agent pulling today's data via Google Search…");
    try {
      const raw = await GS(
        `You are a daily youth basketball digest agent. Use Google Search to find today's most relevant developments.
Return ONLY a raw JSON object — no markdown, no explanation:
{
  "digestDate": "today's date",
  "headline": "one-line biggest story",
  "changes": [{"topic":"","change":"what changed","direction":"up|down|new","magnitude":"specific number or % if available"}],
  "extractedStats": [{"stat":"statistic name","value":"number or string","unit":"% or M or players etc","category":"Stats|Business|Coaching|Laws & Policy|Rankings|Recruitment|Community|Technology|Health","context":"one sentence","date":""}],
  "topStories": [{"title":"","summary":"2 sentences","category":"","isNew":true}]
}`,
        "Search for today's youth basketball news and data: new statistics, rule or policy changes, tournament results, participation numbers, market data, technology or equipment trends. Prioritize stories with specific numbers and measurable data."
      );
      let digest = null;
      try { const m = raw.match(/\{[\s\S]*\}/s); digest = m ? JSON.parse(m[0]) : null; } catch {}
      if (digest) {
        const entry = {...digest, id:`dg_${Date.now()}`, fetchedAt:Date.now()};
        setDigestEntries(p => [entry, ...p.slice(0,29)]);
        if (digest.extractedStats?.length) {
          setStatsDb(p => [
            ...digest.extractedStats.map((s,i) => ({...s, id:`st_${Date.now()}_${i}`, addedAt:Date.now()})),
            ...p
          ].slice(0,200));
        }
        setDigestLastRun(Date.now());
        notify(`Digest done — ${digest.extractedStats?.length||0} stats extracted`);
      } else { notify("Digest: no structured data returned"); }
    } catch(e) { notify("Digest error: "+e.message); }
    setDigestRunning(false);
  }

  // ── Agent 7: QC — Scout audit ──────────────────────────────────────────────
  async function runQCOnScout(articles) {
    if (!articles?.length) return;
    try {
      const sample = articles.slice(0,6).map(a =>
        `Title: "${a.title}" | Cat: ${a.category} | Source: ${a.source} | Stats: ${JSON.stringify(a.keyStats||[])}`
      ).join("\n");
      const parsed = await GJ(
        "You are a QC agent auditing scout output for a youth basketball intelligence system.",
        `SCOUT SAMPLE (${articles.length} total articles):\n${sample}\n\nEvaluate: category accuracy, stat plausibility, source diversity, youth basketball relevance.\n\nReturn JSON:\n{"scoutScore":0.0,"scoutSeverity":"pass|warn|flag|fail","categoryIssues":[],"statIssues":[],"diversityNote":"","relevanceNote":"","suggestions":[],"checkedAt":${Date.now()}}`
      );
      setQcGlobal(prev => ({...prev, scout:parsed}));
    } catch {}
  }

  // ── Agent 7: QC — Full system sweep ───────────────────────────────────────
  async function runFullQCSweep() {
    if (qcRunning) return;
    setQcRunning(true);
    notify("QC Agent running full system audit…");
    try {
      const allT  = tRef.current;
      const allCl = clRef.current;
      const allSt = stRef.current;

      // 1. Cluster assignment audit
      const clusterInput = allT.slice(0,12).map(t => {
        const cl = allCl.find(c=>c.id===t.clusterId);
        return `"${t.raw.slice(0,80)}" → "${cl?.name||"unassigned"}"`;
      }).join("\n");

      const clAudit = await GJ("JSON-only QC agent auditing cluster assignments.",
        `Audit these thought-to-cluster assignments. Are they semantically correct?\n\nAll clusters: ${allCl.map(c=>c.name).join(", ")||"none"}\n\nAssignments:\n${clusterInput||"No thoughts yet"}\n\nReturn JSON:\n{"clusterAuditScore":0.0,"severity":"pass|warn|flag|fail","misassignments":[{"thought":"","assignedTo":"","shouldBe":"","reason":""}],"clusterQualityNote":"","checkedAt":${Date.now()}}`
      );

      // 2. Stats plausibility audit
      const stAudit = allSt.length > 0 ? await GJ("JSON-only QC agent auditing extracted statistics.",
        `Audit these youth basketball stats for plausibility, correct categorization, and duplicates:\n${allSt.slice(0,10).map(s=>`"${s.stat}": ${s.value}${s.unit?" "+s.unit:""} (${s.category}) — ${s.context}`).join("\n")}\n\nReturn JSON:\n{"statsScore":0.0,"severity":"pass|warn|flag|fail","flaggedStats":[{"stat":"","issue":"","severity":"warn|flag|fail"}],"duplicates":[],"note":"","checkedAt":${Date.now()}}`
      ) : { statsScore:1.0, severity:"pass", flaggedStats:[], duplicates:[], note:"No stats to audit", checkedAt:Date.now() };

      // 3. Cross-agent consistency audit
      const completed = allT.filter(t => t.synthesis && t.research);
      const consistInput = completed.slice(0,4).map(t =>
        `Thought: "${t.raw.slice(0,60)}"\nResearch: "${(t.research||"").slice(0,120)}"\nSynthesis: "${(t.synthesis||"").slice(0,120)}"`
      ).join("\n---\n");

      const conAudit = completed.length > 0 ? await GJ("JSON-only QC agent auditing cross-agent consistency.",
        `Do the researcher and synthesizer outputs align with each other and the original thought?\n\n${consistInput}\n\nReturn JSON:\n{"consistencyScore":0.0,"severity":"pass|warn|flag|fail","inconsistencies":[{"thought":"","issue":"","agents":"researcher|synthesizer|both"}],"overallNote":"","checkedAt":${Date.now()}}`
      ) : { consistencyScore:1.0, severity:"pass", inconsistencies:[], overallNote:"No completed thoughts yet", checkedAt:Date.now() };

      const scores = [clAudit.clusterAuditScore, stAudit.statsScore, conAudit.consistencyScore].filter(s => s != null);
      const overall = scores.length ? scores.reduce((a,b)=>a+b,0)/scores.length : 0;
      const sevs    = [clAudit.severity, stAudit.severity, conAudit.severity];
      const worstSev = sevs.includes("fail")?"fail":sevs.includes("flag")?"flag":sevs.includes("warn")?"warn":"pass";

      const sweep = { id:`qc_${Date.now()}`, runAt:Date.now(), overallScore:overall, overallSeverity:worstSev, thoughtsAudited:allT.length, statsAudited:allSt.length, clustersAudited:allCl.length, clusterAudit:clAudit, statsAudit:stAudit, consistencyAudit:conAudit };
      setQcGlobal(prev => ({...prev, sweep}));
      setQcLastRun(Date.now());
      notify(`QC Sweep — ${worstSev.toUpperCase()} (${Math.round(overall*100)}%)`);
    } catch(e) { notify("QC sweep error: "+e.message); }
    setQcRunning(false);
  }


  // ── Derived state ──────────────────────────────────────────────────────────
  const selected        = thoughts.find(t => t.id===selectedId);
  const selCluster      = clusters.find(c => c.id===selected?.clusterId);
  const selQcReport     = qcReports.find(r => r.thoughtId===selectedId);
  const scoutCats       = ["All",...Array.from(new Set(scoutArticles.map(a=>a.category))).sort()];
  const filteredArts    = scoutFilter==="All" ? scoutArticles : scoutArticles.filter(a=>a.category===scoutFilter);
  const statsByCat      = Object.entries(statsDb.reduce((acc,s)=>{ acc[s.category]=(acc[s.category]||[]); acc[s.category].push(s); return acc; },{})).sort((a,b)=>b[1].length-a[1].length);
  const clustersSorted  = [...clusters].sort((a,b)=>(b.thoughtCount||0)-(a.thoughtCount||0));
  const sweep           = qcGlobal?.sweep;
  const scoutQc         = qcGlobal?.scout;
  const qcStats = {
    total:   thoughts.length,
    passed:  thoughts.filter(t=>t.qcSeverity==="pass").length,
    warned:  thoughts.filter(t=>t.qcSeverity==="warn").length,
    flagged: thoughts.filter(t=>["flag","fail"].includes(t.qcSeverity)).length,
    avg:     thoughts.filter(t=>t.qcScore!=null).reduce((a,t,_,arr)=>a+(t.qcScore/arr.length),0)
  };

  const TABS = [
    { id:"capture",  label:"Capture",                         icon:"⊕" },
    { id:"thoughts", label:`Thoughts (${thoughts.length})`,   icon:"◎" },
    { id:"clusters", label:`Clusters (${clusters.length})`,   icon:"◈" },
    { id:"scout",    label:`Scout (${scoutArticles.length})`, icon:"⬡", accent:"#38bdf8" },
    { id:"digest",   label:"Digest",                          icon:"◆", accent:"#34d399" },
    { id:"statsdb",  label:`Stats DB (${statsDb.length})`,    icon:"▣", accent:"#fbbf24" },
    { id:"qc",       label:`QC (${qcReports.length})`,        icon:"⊛", accent:QC_COLOR },
  ];


  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:"100vh", background:"#060810", fontFamily:"'DM Sans',sans-serif", color:"#d8e0f0", display:"flex", flexDirection:"column", position:"relative" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300&family=Syne+Mono&family=Syne:wght@400;500;600;700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:3px;height:3px}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.07);border-radius:2px}
        @keyframes pp{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.4;transform:scale(0.6)}}
        @keyframes fu{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes si{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:translateX(0)}}
        @keyframes nt{0%{opacity:0;transform:translateY(6px)}10%{opacity:1;transform:translateY(0)}85%{opacity:1}100%{opacity:0}}
        @keyframes spin{to{transform:rotate(360deg)}}
        textarea:focus,input:focus{outline:none}
        textarea{resize:none}
        button{cursor:pointer;font-family:inherit}
        .hr:hover{background:rgba(255,255,255,0.04)!important}
        .art:hover{border-color:rgba(255,255,255,0.12)!important;background:rgba(255,255,255,0.04)!important}
        .tb:hover{color:#d8e0f0!important}
      `}</style>

      {/* BG grid */}
      <div style={{ position:"fixed",inset:0,pointerEvents:"none",zIndex:0,backgroundImage:"linear-gradient(rgba(255,255,255,0.022) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.022) 1px,transparent 1px)",backgroundSize:"44px 44px" }} />


      {/* Toast */}
      {toast && <div style={{ position:"fixed",bottom:24,right:24,zIndex:999,background:"rgba(6,8,16,0.95)",border:"1px solid rgba(255,255,255,0.09)",color:"#d8e0f0",padding:"10px 18px",borderRadius:10,fontSize:12,fontFamily:"'Syne Mono',monospace",animation:"nt 3.5s ease forwards",backdropFilter:"blur(12px)" }}>{toast.msg}</div>}

      {/* Header */}
      <div style={{ position:"relative",zIndex:10,background:"rgba(6,8,16,0.87)",backdropFilter:"blur(14px)",borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ display:"flex",alignItems:"center",gap:14,padding:"16px 28px 0",flexWrap:"wrap" }}>
          <div style={{ width:38,height:38,borderRadius:10,background:"linear-gradient(135deg,#0f172a,#1e293b)",border:"1px solid rgba(255,255,255,0.08)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18 }}>◎</div>
          <div>
            <div style={{ fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:16,letterSpacing:"-0.03em",color:"#f0f4ff" }}>Tangent Brain</div>
            <div style={{ fontSize:10,color:"#1e2a3a",fontFamily:"'Syne Mono',monospace",letterSpacing:"0.05em" }}>7-AGENT · GEMINI 2.0 FLASH · GOOGLE SEARCH · PERSISTENT</div>
          </div>
          <div style={{ marginLeft:"auto",display:"flex",gap:6,alignItems:"center",flexWrap:"wrap" }}>
            <AgentPill label="CLASSIFIER" running={thoughts.some(t=>t.agentStatus?.classify==="running")}  color="#a78bfa" />
            <AgentPill label="RESEARCHER" running={thoughts.some(t=>t.agentStatus?.research==="running")}  color="#60a5fa" />
            <AgentPill label="ENRICHER"   running={thoughts.some(t=>t.agentStatus?.enrich==="running")}   color="#f472b6" />
            <AgentPill label="SYNTH"      running={thoughts.some(t=>t.agentStatus?.output==="running")}   color="#34d399" />
            <AgentPill label="SCOUT"      running={scoutRunning}                                           color="#38bdf8" />
            <AgentPill label="DIGEST"     running={digestRunning}                                          color="#fbbf24" />
            <AgentPill label="QC"         running={qcRunning||thoughts.some(t=>t.agentStatus?.qc==="running")} color={QC_COLOR} />
          </div>
        </div>
        <div style={{ display:"flex",padding:"0 28px",gap:0,overflowX:"auto" }}>
          {TABS.map(t=>(
            <button key={t.id} className="tb" onClick={()=>setTab(t.id)} style={{ padding:"9px 16px",background:"none",border:"none",borderBottom:`2px solid ${tab===t.id?(t.accent||"#60a5fa"):"transparent"}`,color:tab===t.id?(t.accent||"#93c5fd"):"#2a3a50",fontSize:12,fontWeight:tab===t.id?500:400,transition:"all 0.2s",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:5 }}>
              <span>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div style={{ flex:1,position:"relative",zIndex:1,overflow:"hidden" }}>

        {/* CAPTURE */}
        {tab==="capture" && (
          <div style={{ maxWidth:580,margin:"36px auto",padding:"0 24px",animation:"fu 0.3s ease" }}>
            <Panel style={{ padding:26,marginBottom:16 }}>
              <SectionLabel>WHAT JUST SPARKED?</SectionLabel>
              <textarea value={input} onChange={e=>setInput(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey))capture();}}
                placeholder="You heard something and your brain went somewhere... capture it."
                rows={5} style={{ width:"100%",background:"transparent",border:"none",color:"#d8e0f0",fontSize:15,lineHeight:1.75,fontFamily:"'DM Sans',sans-serif" }} />
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:14,paddingTop:14,borderTop:"1px solid rgba(255,255,255,0.05)" }}>
                <span style={{ fontSize:10,color:"#1e2a3a",fontFamily:"'Syne Mono',monospace" }}>⌘+ENTER</span>
                <button onClick={capture} disabled={!input.trim()||capturing}
                  style={{ padding:"9px 22px",borderRadius:8,border:"none",background:input.trim()?"linear-gradient(135deg,#1d4ed8,#7c3aed)":"rgba(255,255,255,0.04)",color:input.trim()?"#f0f4ff":"#1e2a3a",fontSize:13,fontWeight:500,boxShadow:input.trim()?"0 0 22px rgba(124,58,237,0.3)":"none",transition:"all 0.25s" }}>
                  {capturing ? "Launching…" : "⊕  Capture Thought"}
                </button>
              </div>
            </Panel>
            <Panel style={{ padding:"20px 22px" }}>
              <SectionLabel>7 AGENTS · POWERED BY GEMINI 2.0 FLASH</SectionLabel>
              {[
                {c:"#a78bfa",i:"⬡",n:"Classifier",    d:"Reads your thought + all existing clusters. Matches or creates domains organically — no predetermined categories."},
                {c:"#60a5fa",i:"◎",n:"Researcher",    d:"Deep-dives the concept. Context, history, key figures, why it matters."},
                {c:"#f472b6",i:"◈",n:"Enricher",      d:"Cross-references all past thoughts across all clusters. Surfaces unexpected connections and unexplored angles."},
                {c:"#34d399",i:"◆",n:"Synthesizer",   d:"Produces a Thought Report: core insight, why it matters to you, unexpected angle, action items."},
                {c:"#38bdf8",i:"⬡",n:"Scout",         d:"Uses Google Search to find current youth basketball news and categorizes by topic (Stats, Business, Coaching, etc.)."},
                {c:"#fbbf24",i:"▣",n:"Daily Digest",  d:"Uses Google Search to pull today's changes, extracts hard stats and populates the Stats DB."},
                {c:QC_COLOR, i:"⊛",n:"QC Agent",      d:"Audits every agent for accuracy, cluster correctness, stat validity, and cross-agent consistency. Auto-runs after each thought; manual sweep available."},
              ].map(a=>(
                <div key={a.n} style={{ display:"flex",gap:12,marginBottom:14 }}>
                  <div style={{ width:30,height:30,borderRadius:7,flexShrink:0,background:`${a.c}12`,border:`1px solid ${a.c}28`,display:"flex",alignItems:"center",justifyContent:"center",color:a.c,fontSize:13 }}>{a.i}</div>
                  <div>
                    <div style={{ fontSize:12,fontWeight:600,color:a.c,marginBottom:2,fontFamily:"'Syne',sans-serif" }}>{a.n}</div>
                    <div style={{ fontSize:11,color:"#3d4a63",lineHeight:1.6 }}>{a.d}</div>
                  </div>
                </div>
              ))}
            </Panel>
          </div>
        )}

        {/* THOUGHTS */}
        {tab==="thoughts" && (
          <div style={{ display:"grid",gridTemplateColumns:"300px 1fr",height:"calc(100vh - 120px)",animation:"fu 0.3s ease" }}>
            <div style={{ overflowY:"auto",borderRight:"1px solid rgba(255,255,255,0.05)",padding:"12px 0" }}>
              {thoughts.length===0 && <div style={{ textAlign:"center",color:"#1e2a3a",padding:40 }}><div style={{ fontSize:30,marginBottom:10 }}>◎</div><div style={{ fontSize:11,fontFamily:"'Syne Mono',monospace" }}>No thoughts yet</div></div>}
              {thoughts.map(t => {
                const cl=clusters.find(c=>c.id===t.clusterId); const col=cl?.color||"#3d4a63"; const isSel=selectedId===t.id;
                return (
                  <div key={t.id} className="hr" onClick={()=>setSelectedId(t.id)}
                    style={{ padding:"11px 18px",cursor:"pointer",background:isSel?"rgba(96,165,250,0.05)":"transparent",borderLeft:`3px solid ${isSel?col:"transparent"}`,transition:"all 0.2s",animation:"si 0.2s ease" }}>
                    <div style={{ display:"flex",gap:6,alignItems:"flex-start",marginBottom:7 }}>
                      <div style={{ fontSize:12,color:isSel?"#d8e0f0":"#6b7fa0",lineHeight:1.5,flex:1 }}>{t.raw.length>65?t.raw.slice(0,65)+"…":t.raw}</div>
                      {t.qcSeverity && <span style={{ fontSize:9,color:SEV[t.qcSeverity]?.color,marginTop:1,flexShrink:0 }}>{SEV[t.qcSeverity]?.icon}</span>}
                    </div>
                    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                      {cl ? <Badge label={cl.name} color={col} small /> : <span style={{ fontSize:10,color:"#1e2640",fontFamily:"'Syne Mono',monospace" }}>classifying…</span>}
                      <div style={{ display:"flex",gap:3 }}>{["classify","research","enrich","output","qc"].map(s=><Pip key={s} status={t.agentStatus?.[s]||"idle"} color={s==="qc"?QC_COLOR:col} />)}</div>
                    </div>
                    <div style={{ fontSize:9,color:"#1e2a3a",marginTop:5,fontFamily:"'Syne Mono',monospace" }}>{ago(t.timestamp)}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ overflowY:"auto",padding:"22px 28px" }}>
              {!selected
                ? <div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",color:"#1e2a3a" }}><div style={{ fontSize:40,marginBottom:12 }}>◎</div><div style={{ fontFamily:"'Syne Mono',monospace",fontSize:11 }}>Select a thought</div></div>
                : (
                  <div style={{ animation:"fu 0.3s ease",maxWidth:700 }}>
                    <Panel style={{ padding:"18px 22px",marginBottom:20,borderColor:selCluster?`${selCluster.color}22`:"rgba(255,255,255,0.06)" }}>
                      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,marginBottom:10 }}>
                        <p style={{ fontSize:15,color:"#d8e0f0",lineHeight:1.7,fontStyle:"italic",flex:1 }}>"{selected.raw}"</p>
                        <div style={{ display:"flex",flexDirection:"column",gap:6,alignItems:"flex-end" }}>
                          {selCluster && <Badge label={selCluster.name} color={selCluster.color} />}
                          {selected.qcSeverity && <QCBadge severity={selected.qcSeverity} />}
                        </div>
                      </div>
                      {selected.classifierReasoning && <div style={{ fontSize:11,color:"#3d4a63",fontFamily:"'Syne Mono',monospace",lineHeight:1.5 }}>↳ {selected.classifierReasoning}</div>}
                      <div style={{ fontSize:9,color:"#1e2a3a",marginTop:7,fontFamily:"'Syne Mono',monospace" }}>{new Date(selected.timestamp).toLocaleString()}</div>
                    </Panel>
                    {[
                      {key:"research",  ag:"research", label:"◎ RESEARCHER",  col:"#60a5fa", qcKey:"researcher"},
                      {key:"enrichment",ag:"enrich",   label:"◈ ENRICHER",    col:"#f472b6", qcKey:"enricher"},
                      {key:"synthesis", ag:"output",   label:"◆ SYNTHESIZER", col:"#34d399", qcKey:"synthesizer"},
                    ].map(({key,ag,label,col,qcKey}) => {
                      const agQc = selQcReport?.agents?.[qcKey];
                      return (
                        <div key={key} style={{ marginBottom:18 }}>
                          <div style={{ display:"flex",alignItems:"center",gap:7,marginBottom:8 }}>
                            <span style={{ fontSize:9,color:col,fontFamily:"'Syne Mono',monospace",letterSpacing:"0.08em" }}>{label}</span>
                            <Pip status={selected.agentStatus?.[ag]||"idle"} color={col} />
                            {agQc && <QCBadge severity={agQc.severity} />}
                          </div>
                          <Panel style={{ padding:"14px 16px",minHeight:56 }}>
                            {selected.agentStatus?.[ag]==="running" && <div style={{ color:"#fbbf24",fontSize:11,fontFamily:"'Syne Mono',monospace",animation:"pp 1s infinite" }}>Processing…</div>}
                            {selected.agentStatus?.[ag]==="idle" && !selected[key] && <div style={{ color:"#1e2a3a",fontSize:11,fontFamily:"'Syne Mono',monospace" }}>Queued</div>}
                            {selected[key] && <div style={{ fontSize:12,color:"#7a90b0",lineHeight:1.8,whiteSpace:"pre-wrap" }}>{selected[key]}</div>}
                          </Panel>
                          {agQc && agQc.severity!=="pass" && (
                            <div style={{ marginTop:6,padding:"8px 12px",borderRadius:8,background:`${QC_COLOR}0a`,border:`1px solid ${QC_COLOR}22`,display:"flex",gap:8 }}>
                              <span style={{ color:QC_COLOR,fontSize:10,flexShrink:0,marginTop:1 }}>⊛</span>
                              <div>
                                {agQc.issues?.map((iss,i)=><div key={i} style={{ fontSize:11,color:"#7a6a5a",marginBottom:2 }}>{iss}</div>)}
                                {agQc.suggestion && <div style={{ fontSize:11,color:`${QC_COLOR}99`,fontStyle:"italic" }}>→ {agQc.suggestion}</div>}
                                <div style={{ marginTop:6 }}><ConfidenceBar score={(agQc.accuracy+agQc.relevance+agQc.quality)/3} /></div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {/* QC panel */}
                    <div style={{ marginBottom:18 }}>
                      <div style={{ display:"flex",alignItems:"center",gap:7,marginBottom:8 }}>
                        <span style={{ fontSize:9,color:QC_COLOR,fontFamily:"'Syne Mono',monospace",letterSpacing:"0.08em" }}>⊛ QC AGENT</span>
                        <Pip status={selected.agentStatus?.qc||"idle"} color={QC_COLOR} />
                      </div>
                      <Panel style={{ padding:"14px 16px",minHeight:56,borderColor:`${QC_COLOR}18` }}>
                        {selected.agentStatus?.qc==="running" && <div style={{ color:"#fbbf24",fontSize:11,fontFamily:"'Syne Mono',monospace",animation:"pp 1s infinite" }}>Auditing all agents…</div>}
                        {selected.agentStatus?.qc==="idle" && !selQcReport && <div style={{ color:"#1e2a3a",fontSize:11,fontFamily:"'Syne Mono',monospace" }}>Runs after pipeline completes</div>}
                        {selQcReport && (
                          <div>
                            <div style={{ display:"flex",gap:10,alignItems:"center",marginBottom:12 }}>
                              <QCBadge severity={selQcReport.overallSeverity} />
                              <ConfidenceBar score={selQcReport.overallScore} />
                            </div>
                            <div style={{ fontSize:12,color:"#7a90b0",lineHeight:1.7,marginBottom:10 }}>{selQcReport.summary}</div>
                            {!selQcReport.clusterCorrect && (
                              <div style={{ padding:"8px 12px",borderRadius:8,background:`${QC_COLOR}0a`,border:`1px solid ${QC_COLOR}1a`,marginBottom:8 }}>
                                <div style={{ fontSize:10,color:QC_COLOR,fontFamily:"'Syne Mono',monospace",marginBottom:4 }}>CLUSTER FLAG</div>
                                <div style={{ fontSize:11,color:"#7a6a5a" }}>{selQcReport.clusterNote}</div>
                                {selQcReport.suggestedCluster && <div style={{ fontSize:11,color:`${QC_COLOR}99`,marginTop:3 }}>Suggested: "{selQcReport.suggestedCluster}"</div>}
                              </div>
                            )}
                            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8 }}>
                              {Object.entries(selQcReport.agents||{}).map(([name,agQc])=>(
                                <div key={name} style={{ padding:"8px 10px",borderRadius:7,background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)" }}>
                                  <div style={{ display:"flex",justifyContent:"space-between",marginBottom:6 }}>
                                    <span style={{ fontSize:9,color:"#4a5a75",fontFamily:"'Syne Mono',monospace",textTransform:"uppercase" }}>{name}</span>
                                    <QCBadge severity={agQc.severity} />
                                  </div>
                                  <ConfidenceBar score={(agQc.accuracy+agQc.relevance+agQc.quality)/3} />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </Panel>
                    </div>
                  </div>
                )
              }
            </div>
          </div>
        )}

        {/* CLUSTERS */}
        {tab==="clusters" && (
          <div style={{ padding:"24px 28px",overflowY:"auto",height:"calc(100vh - 120px)",animation:"fu 0.3s ease" }}>
            {clusters.length===0
              ? <div style={{ textAlign:"center",color:"#1e2a3a",paddingTop:70 }}><div style={{ fontSize:38,marginBottom:12 }}>◈</div><div style={{ fontFamily:"'Syne Mono',monospace",fontSize:11 }}>Clusters emerge as you capture thoughts</div></div>
              : <>
                  <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(190px,1fr))",gap:12,marginBottom:28 }}>
                    {clustersSorted.map((cl,i)=>(
                      <div key={cl.id} style={{ background:`${cl.color}0a`,border:`1px solid ${cl.color}25`,borderRadius:13,padding:"16px 18px",cursor:"pointer",transition:"all 0.2s",animation:`fu ${0.1+i*0.04}s ease` }}
                        onClick={()=>{const f=thoughts.find(t=>t.clusterId===cl.id);if(f){setSelectedId(f.id);setTab("thoughts");}}}
                        onMouseEnter={e=>e.currentTarget.style.background=`${cl.color}14`}
                        onMouseLeave={e=>e.currentTarget.style.background=`${cl.color}0a`}>
                        <div style={{ display:"flex",justifyContent:"space-between",marginBottom:8 }}>
                          <div style={{ width:9,height:9,borderRadius:"50%",background:cl.color,boxShadow:`0 0 7px ${cl.color}`,marginTop:3 }} />
                          <span style={{ fontSize:22,fontWeight:800,fontFamily:"'Syne',sans-serif",color:cl.color }}>{cl.thoughtCount||0}</span>
                        </div>
                        <div style={{ fontSize:13,fontWeight:600,color:"#d8e0f0",fontFamily:"'Syne',sans-serif",marginBottom:3,lineHeight:1.3 }}>{cl.name}</div>
                        <div style={{ fontSize:10,color:"#2a3a50",fontFamily:"'Syne Mono',monospace",marginBottom:10 }}>{cl.exampleTopics}</div>
                        <div style={{ height:2,background:"rgba(255,255,255,0.04)",borderRadius:1,overflow:"hidden" }}>
                          <div style={{ height:"100%",width:`${Math.round(((cl.thoughtCount||0)/Math.max(...clusters.map(c=>c.thoughtCount||1)))*100)}%`,background:cl.color,transition:"width 1s ease" }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ borderTop:"1px solid rgba(255,255,255,0.05)",paddingTop:24 }}>
                    <SectionLabel color="#2a3a50">ALL THOUGHTS BY CLUSTER</SectionLabel>
                    {clustersSorted.filter(c=>(c.thoughtCount||0)>0).map(cl=>{
                      const cts=thoughts.filter(t=>t.clusterId===cl.id);
                      return (
                        <div key={cl.id} style={{ marginBottom:22 }}>
                          <div style={{ display:"flex",alignItems:"center",gap:9,marginBottom:10 }}>
                            <div style={{ width:7,height:7,borderRadius:"50%",background:cl.color,boxShadow:`0 0 6px ${cl.color}` }} />
                            <span style={{ fontFamily:"'Syne',sans-serif",fontWeight:600,fontSize:13,color:cl.color }}>{cl.name}</span>
                            <span style={{ fontSize:9,color:"#1e2a3a",fontFamily:"'Syne Mono',monospace" }}>{cts.length} thought{cts.length!==1?"s":""}</span>
                          </div>
                          <div style={{ paddingLeft:16,borderLeft:`1px solid ${cl.color}28` }}>
                            {cts.map(t=>(
                              <div key={t.id} className="hr" onClick={()=>{setSelectedId(t.id);setTab("thoughts");}}
                                style={{ padding:"7px 11px",marginBottom:3,borderRadius:7,background:"rgba(255,255,255,0.015)",cursor:"pointer",transition:"all 0.2s",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8 }}>
                                <span style={{ fontSize:12,color:"#c4cfdf",lineHeight:1.5 }}>{t.raw.length>85?t.raw.slice(0,85)+"…":t.raw}</span>
                                <div style={{ display:"flex",alignItems:"center",gap:6,flexShrink:0 }}>
                                  {t.qcSeverity && <QCBadge severity={t.qcSeverity} />}
                                  <span style={{ color:"#1e2a3a",fontFamily:"'Syne Mono',monospace",fontSize:9 }}>{ago(t.timestamp)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
            }
          </div>
        )}

        {/* SCOUT */}
        {tab==="scout" && (
          <div style={{ height:"calc(100vh - 120px)",display:"flex",flexDirection:"column",animation:"fu 0.3s ease" }}>
            <div style={{ padding:"14px 28px",borderBottom:"1px solid rgba(255,255,255,0.05)",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap" }}>
              <button onClick={runScout} disabled={scoutRunning}
                style={{ padding:"8px 20px",borderRadius:8,border:"none",background:scoutRunning?"rgba(56,189,248,0.1)":"linear-gradient(135deg,#0369a1,#0284c7)",color:scoutRunning?"#38bdf8":"#f0f4ff",fontSize:12,fontWeight:500,display:"flex",alignItems:"center",gap:7,boxShadow:scoutRunning?"none":"0 0 18px rgba(56,189,248,0.2)",transition:"all 0.25s" }}>
                {scoutRunning ? <><Spinner color="#38bdf8" />Searching via Google…</> : "⬡ Run Scout Agent"}
              </button>
              {scoutLastRun && <span style={{ fontSize:10,color:"#2a3a50",fontFamily:"'Syne Mono',monospace" }}>Last run {ago(scoutLastRun)}</span>}
              {scoutQc && <QCBadge severity={scoutQc.scoutSeverity} />}
              <div style={{ marginLeft:"auto",display:"flex",gap:6,flexWrap:"wrap" }}>
                {scoutCats.map(cat=>(
                  <button key={cat} onClick={()=>setScoutFilter(cat)}
                    style={{ padding:"4px 10px",borderRadius:16,border:`1px solid ${scoutFilter===cat?(SCOUT_COLORS[cat]||"#60a5fa"):"rgba(255,255,255,0.07)"}`,background:scoutFilter===cat?`${SCOUT_COLORS[cat]||"#60a5fa"}18`:"transparent",color:scoutFilter===cat?(SCOUT_COLORS[cat]||"#60a5fa"):"#3d4a63",fontSize:10,fontFamily:"'Syne Mono',monospace",transition:"all 0.2s",cursor:"pointer" }}>
                    {cat}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ flex:1,overflowY:"auto",padding:"20px 28px" }}>
              {scoutArticles.length===0&&!scoutRunning && (
                <div style={{ textAlign:"center",color:"#1e2a3a",paddingTop:80 }}>
                  <div style={{ fontSize:38,marginBottom:14 }}>⬡</div>
                  <div style={{ fontFamily:"'Syne Mono',monospace",fontSize:11,marginBottom:6 }}>Scout agent hasn't run yet</div>
                  <div style={{ fontSize:11,color:"#1a2230" }}>Powered by Gemini + Google Search — no extra API needed</div>
                </div>
              )}
              <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:14 }}>
                {filteredArts.map(art=>{
                  const col=SCOUT_COLORS[art.category]||"#94a3b8";
                  return (
                    <div key={art.id} className="art" style={{ background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:12,padding:"16px 18px",transition:"all 0.2s" }}>
                      <div style={{ display:"flex",justifyContent:"space-between",gap:10,marginBottom:10 }}>
                        <Badge label={art.category} color={col} small />
                        <span style={{ fontSize:9,color:"#2a3a50",fontFamily:"'Syne Mono',monospace" }}>{art.relevance}</span>
                      </div>
                      <div style={{ fontSize:13,fontWeight:500,color:"#c4cfdf",lineHeight:1.45,marginBottom:8,fontFamily:"'Syne',sans-serif" }}>{art.title}</div>
                      <div style={{ fontSize:11,color:"#4a5a75",lineHeight:1.65,marginBottom:10 }}>{art.summary}</div>
                      {art.keyStats?.length>0 && (
                        <div style={{ borderTop:"1px solid rgba(255,255,255,0.05)",paddingTop:10 }}>
                          {art.keyStats.map((s,i)=><div key={i} style={{ fontSize:10,color:col,fontFamily:"'Syne Mono',monospace",marginBottom:3,display:"flex",gap:6 }}><span style={{opacity:0.5}}>▸</span>{s}</div>)}
                        </div>
                      )}
                      <div style={{ display:"flex",justifyContent:"space-between",marginTop:10,fontSize:9,color:"#1e2a3a",fontFamily:"'Syne Mono',monospace" }}>
                        <span>{art.source}</span><span>{art.date}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* DIGEST */}
        {tab==="digest" && (
          <div style={{ height:"calc(100vh - 120px)",display:"flex",flexDirection:"column",animation:"fu 0.3s ease" }}>
            <div style={{ padding:"14px 28px",borderBottom:"1px solid rgba(255,255,255,0.05)",display:"flex",alignItems:"center",gap:12 }}>
              <button onClick={runDigest} disabled={digestRunning}
                style={{ padding:"8px 20px",borderRadius:8,border:"none",background:digestRunning?"rgba(52,211,153,0.1)":"linear-gradient(135deg,#065f46,#047857)",color:digestRunning?"#34d399":"#f0f4ff",fontSize:12,fontWeight:500,display:"flex",alignItems:"center",gap:7,boxShadow:digestRunning?"none":"0 0 18px rgba(52,211,153,0.18)",transition:"all 0.25s" }}>
                {digestRunning ? <><Spinner color="#34d399" />Searching via Google…</> : "◆ Run Daily Digest"}
              </button>
              {digestLastRun && <span style={{ fontSize:10,color:"#2a3a50",fontFamily:"'Syne Mono',monospace" }}>Last run {ago(digestLastRun)}</span>}
            </div>
            <div style={{ flex:1,overflowY:"auto",padding:"20px 28px" }}>
              {digestEntries.length===0&&!digestRunning && (
                <div style={{ textAlign:"center",color:"#1e2a3a",paddingTop:80 }}>
                  <div style={{ fontSize:38,marginBottom:14 }}>◆</div>
                  <div style={{ fontFamily:"'Syne Mono',monospace",fontSize:11,marginBottom:6 }}>No digest runs yet</div>
                  <div style={{ fontSize:11,color:"#1a2230" }}>Powered by Gemini + Google Search — stats auto-populate the Stats DB</div>
                </div>
              )}
              {digestEntries.map((entry,idx)=>(
                <div key={entry.id} style={{ marginBottom:28,animation:"fu 0.3s ease" }}>
                  <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:14 }}>
                    <div style={{ width:8,height:8,borderRadius:"50%",background:"#34d399",boxShadow:"0 0 7px #34d399" }} />
                    <span style={{ fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:14,color:"#34d399" }}>{entry.digestDate}</span>
                    {idx===0 && <Badge label="LATEST" color="#34d399" small />}
                  </div>
                  {entry.headline && <Panel style={{ padding:"14px 18px",marginBottom:14,borderColor:"rgba(52,211,153,0.15)" }}><div style={{ fontSize:14,color:"#c4cfdf",lineHeight:1.5,fontStyle:"italic" }}>"{entry.headline}"</div></Panel>}
                  {entry.changes?.length>0 && (
                    <div style={{ marginBottom:14 }}>
                      <SectionLabel color="#2a3a50">WHAT CHANGED</SectionLabel>
                      <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:8 }}>
                        {entry.changes.map((ch,i)=>{
                          const isUp=ch.direction==="up"; const isNew=ch.direction==="new";
                          const col=isNew?"#a78bfa":isUp?"#34d399":"#f87171";
                          return (
                            <Panel key={i} style={{ padding:"12px 14px",borderColor:`${col}20` }}>
                              <div style={{ fontSize:10,color:col,fontFamily:"'Syne Mono',monospace",marginBottom:5 }}>{isNew?"✦ NEW":isUp?"↑ UP":"↓ DOWN"}{ch.magnitude?` · ${ch.magnitude}`:""}</div>
                              <div style={{ fontSize:12,fontWeight:500,color:"#c4cfdf",marginBottom:3 }}>{ch.topic}</div>
                              <div style={{ fontSize:11,color:"#4a5a75",lineHeight:1.5 }}>{ch.change}</div>
                            </Panel>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {entry.topStories?.length>0 && (
                    <div>
                      <SectionLabel color="#2a3a50">TOP STORIES</SectionLabel>
                      {entry.topStories.map((s,i)=>{
                        const col=SCOUT_COLORS[s.category]||"#94a3b8";
                        return (
                          <div key={i} style={{ display:"flex",gap:12,marginBottom:10,padding:"10px 12px",borderRadius:9,background:"rgba(255,255,255,0.02)",borderLeft:`3px solid ${col}` }}>
                            <div style={{ flex:1 }}>
                              <div style={{ display:"flex",gap:8,alignItems:"center",marginBottom:5 }}><Badge label={s.category} color={col} small />{s.isNew&&<span style={{ fontSize:9,color:"#a78bfa",fontFamily:"'Syne Mono',monospace" }}>NEW</span>}</div>
                              <div style={{ fontSize:13,fontWeight:500,color:"#c4cfdf",marginBottom:4,fontFamily:"'Syne',sans-serif" }}>{s.title}</div>
                              <div style={{ fontSize:11,color:"#4a5a75",lineHeight:1.5 }}>{s.summary}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {idx<digestEntries.length-1 && <div style={{ borderBottom:"1px solid rgba(255,255,255,0.05)",marginTop:20 }} />}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STATS DB */}
        {tab==="statsdb" && (
          <div style={{ height:"calc(100vh - 120px)",overflowY:"auto",padding:"24px 28px",animation:"fu 0.3s ease" }}>
            {statsDb.length===0
              ? <div style={{ textAlign:"center",color:"#1e2a3a",paddingTop:80 }}><div style={{ fontSize:38,marginBottom:14 }}>▣</div><div style={{ fontFamily:"'Syne Mono',monospace",fontSize:11,marginBottom:8 }}>Stats database empty</div><div style={{ fontSize:11,color:"#1a2230" }}>Run the Daily Digest to populate with real stats from Google Search</div></div>
              : <>
                  <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(155px,1fr))",gap:10,marginBottom:24 }}>
                    <StatCard label="TOTAL STATS"  value={statsDb.length}          unit="entries" color="#fbbf24" />
                    <StatCard label="CATEGORIES"   value={statsByCat.length}        unit="active"  color="#a78bfa" />
                    <StatCard label="DIGEST RUNS"  value={digestEntries.length}     unit="runs"    color="#34d399" />
                    <StatCard label="ARTICLES"     value={scoutArticles.length}     unit="indexed" color="#38bdf8" />
                  </div>
                  <SectionLabel color="#2a3a50">STATS BY CATEGORY</SectionLabel>
                  <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:10,marginBottom:28 }}>
                    {statsByCat.map(([cat,stats])=>{
                      const col=SCOUT_COLORS[cat]||"#94a3b8";
                      const pct=Math.round((stats.length/statsDb.length)*100);
                      return (
                        <Panel key={cat} style={{ padding:"14px 16px" }}>
                          <div style={{ display:"flex",justifyContent:"space-between",marginBottom:8 }}><span style={{ fontSize:11,color:col,fontFamily:"'Syne Mono',monospace" }}>{cat}</span><span style={{ fontSize:11,color:"#2a3a50",fontFamily:"'Syne Mono',monospace" }}>{stats.length} · {pct}%</span></div>
                          <div style={{ height:3,background:"rgba(255,255,255,0.04)",borderRadius:2,overflow:"hidden",marginBottom:10 }}><div style={{ height:"100%",width:`${pct}%`,background:col,boxShadow:`0 0 5px ${col}`,transition:"width 1s ease" }} /></div>
                          {stats[0] && <div style={{ fontSize:10,color:"#4a5a75",fontFamily:"'Syne Mono',monospace",lineHeight:1.5 }}>Latest: <span style={{color:col}}>{stats[0].value}{stats[0].unit?" "+stats[0].unit:""}</span> — {stats[0].stat}</div>}
                        </Panel>
                      );
                    })}
                  </div>
                  <SectionLabel color="#2a3a50">ALL EXTRACTED STATS ({statsDb.length})</SectionLabel>
                  <Panel style={{ overflow:"hidden" }}>
                    <div style={{ overflowX:"auto" }}>
                      <table style={{ width:"100%",borderCollapse:"collapse",fontSize:12 }}>
                        <thead><tr style={{ borderBottom:"1px solid rgba(255,255,255,0.07)" }}>{["STAT","VALUE","CATEGORY","CONTEXT","DATE"].map(h=><th key={h} style={{ padding:"10px 14px",textAlign:"left",fontSize:9,color:"#2a3a50",fontFamily:"'Syne Mono',monospace",letterSpacing:"0.07em",fontWeight:400,whiteSpace:"nowrap" }}>{h}</th>)}</tr></thead>
                        <tbody>
                          {statsDb.map((s,i)=>{
                            const col=SCOUT_COLORS[s.category]||"#94a3b8";
                            return (
                              <tr key={s.id} style={{ borderBottom:"1px solid rgba(255,255,255,0.04)",background:i%2===0?"transparent":"rgba(255,255,255,0.01)" }}>
                                <td style={{ padding:"9px 14px",color:"#c4cfdf",fontWeight:500,maxWidth:200 }}>{s.stat}</td>
                                <td style={{ padding:"9px 14px",color:col,fontFamily:"'Syne Mono',monospace",fontWeight:700,whiteSpace:"nowrap" }}>{fmt(s.value)}{s.unit?" "+s.unit:""}</td>
                                <td style={{ padding:"9px 14px" }}><Badge label={s.category} color={col} small /></td>
                                <td style={{ padding:"9px 14px",color:"#4a5a75",maxWidth:260,lineHeight:1.5 }}>{s.context}</td>
                                <td style={{ padding:"9px 14px",color:"#2a3a50",fontFamily:"'Syne Mono',monospace",fontSize:10,whiteSpace:"nowrap" }}>{s.date}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </Panel>
                </>
            }
          </div>
        )}

        {/* QC */}
        {tab==="qc" && (
          <div style={{ height:"calc(100vh - 120px)",display:"flex",flexDirection:"column",animation:"fu 0.3s ease" }}>
            <div style={{ padding:"14px 28px",borderBottom:"1px solid rgba(255,255,255,0.05)",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap" }}>
              <button onClick={runFullQCSweep} disabled={qcRunning}
                style={{ padding:"8px 20px",borderRadius:8,border:"none",background:qcRunning?`${QC_COLOR}15`:"linear-gradient(135deg,#7c2d12,#c2410c)",color:qcRunning?QC_COLOR:"#f0f4ff",fontSize:12,fontWeight:500,display:"flex",alignItems:"center",gap:7,boxShadow:qcRunning?"none":`0 0 18px ${QC_COLOR}28`,transition:"all 0.25s" }}>
                {qcRunning ? <><Spinner color={QC_COLOR} />Auditing system…</> : "⊛ Run Full QC Sweep"}
              </button>
              {qcLastRun && <span style={{ fontSize:10,color:"#2a3a50",fontFamily:"'Syne Mono',monospace" }}>Last sweep {ago(qcLastRun)}</span>}
              <div style={{ marginLeft:"auto",display:"flex",gap:10,alignItems:"center" }}>
                {[{l:"PASS",n:qcStats.passed,c:"#34d399"},{l:"WARN",n:qcStats.warned,c:"#fbbf24"},{l:"FLAG",n:qcStats.flagged,c:QC_COLOR}].map(s=>(
                  <div key={s.l} style={{ display:"flex",alignItems:"center",gap:5,fontSize:10,fontFamily:"'Syne Mono',monospace",color:s.c }}>
                    <div style={{ width:6,height:6,borderRadius:"50%",background:s.c }} />{s.n} {s.l}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ flex:1,overflowY:"auto",padding:"20px 28px" }}>
              <div style={{ marginBottom:28 }}>
                <SectionLabel color="#2a3a50">SYSTEM HEALTH</SectionLabel>
                <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(155px,1fr))",gap:10,marginBottom:20 }}>
                  <StatCard label="THOUGHTS AUDITED" value={qcStats.total}                              unit=""  color={QC_COLOR} />
                  <StatCard label="AVG QC SCORE"      value={`${Math.round((qcStats.avg||0)*100)}`}    unit="%" color="#34d399" />
                  <StatCard label="FLAGS + FAILS"      value={qcStats.flagged}                          unit=""  color="#f87171" />
                  <StatCard label="QC REPORTS"         value={qcReports.length}                         unit=""  color="#a78bfa" />
                </div>
                {sweep && (
                  <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:14,marginBottom:24 }}>
                    {[
                      { label:"CLUSTER AUDIT",         data:sweep.clusterAudit,     scoreKey:"clusterAuditScore",  issuesKey:"misassignments",  noteKey:"clusterQualityNote" },
                      { label:"STATS AUDIT",           data:sweep.statsAudit,       scoreKey:"statsScore",         issuesKey:"flaggedStats",     noteKey:"note" },
                      { label:"CROSS-AGENT CONSISTENCY",data:sweep.consistencyAudit,scoreKey:"consistencyScore",   issuesKey:"inconsistencies",  noteKey:"overallNote" },
                    ].map(({label,data,scoreKey,issuesKey,noteKey})=>(
                      <Panel key={label} style={{ padding:"18px 20px",borderColor:`${QC_COLOR}18` }}>
                        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12 }}>
                          <span style={{ fontSize:9,color:QC_COLOR,fontFamily:"'Syne Mono',monospace",letterSpacing:"0.07em" }}>⊛ {label}</span>
                          <QCBadge severity={data?.severity||"warn"} />
                        </div>
                        <ConfidenceBar score={data?.[scoreKey]||0} />
                        {data?.[noteKey] && <div style={{ fontSize:11,color:"#5a6a7a",marginTop:10,lineHeight:1.5 }}>{data[noteKey]}</div>}
                        {data?.[issuesKey]?.length>0 && (
                          <div style={{ marginTop:10 }}>
                            {data[issuesKey].slice(0,3).map((item,i)=>(
                              <div key={i} style={{ padding:"6px 8px",borderRadius:6,background:`${QC_COLOR}08`,border:`1px solid ${QC_COLOR}18`,marginBottom:5,fontSize:10,color:"#8a7a6a",lineHeight:1.4 }}>
                                {item.thought||item.stat||""}{(item.shouldBe||item.issue)&&<span style={{color:`${QC_COLOR}99`}}> → {item.shouldBe||item.issue}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </Panel>
                    ))}
                    {scoutQc && (
                      <Panel style={{ padding:"18px 20px",borderColor:`${QC_COLOR}18` }}>
                        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12 }}>
                          <span style={{ fontSize:9,color:QC_COLOR,fontFamily:"'Syne Mono',monospace",letterSpacing:"0.07em" }}>⊛ SCOUT AUDIT</span>
                          <QCBadge severity={scoutQc.scoutSeverity||"warn"} />
                        </div>
                        <ConfidenceBar score={scoutQc.scoutScore||0} />
                        {scoutQc.relevanceNote && <div style={{ fontSize:11,color:"#5a6a7a",marginTop:10,lineHeight:1.5 }}>{scoutQc.relevanceNote}</div>}
                        {scoutQc.suggestions?.filter(Boolean).map((s,i)=><div key={i} style={{ fontSize:10,color:`${QC_COLOR}88`,marginTop:5,fontStyle:"italic" }}>• {s}</div>)}
                      </Panel>
                    )}
                  </div>
                )}
              </div>
              {qcReports.length>0 && (
                <div>
                  <SectionLabel color="#2a3a50">PER-THOUGHT QC REPORTS ({qcReports.length})</SectionLabel>
                  <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
                    {qcReports.map(r=>{
                      const t=thoughts.find(th=>th.id===r.thoughtId);
                      const isExp=expandedQcId===r.thoughtId;
                      return (
                        <Panel key={r.thoughtId} style={{ overflow:"hidden",borderColor:isExp?`${QC_COLOR}25`:"rgba(255,255,255,0.06)" }}>
                          <div style={{ padding:"14px 18px",cursor:"pointer",display:"flex",alignItems:"center",gap:12 }} onClick={()=>setExpandedQcId(isExp?null:r.thoughtId)}>
                            <QCBadge severity={r.overallSeverity} />
                            <div style={{ flex:1,minWidth:0 }}>
                              <div style={{ fontSize:12,color:"#c4cfdf",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{t?.raw||r.thoughtId}</div>
                              <div style={{ fontSize:10,color:"#2a3a50",fontFamily:"'Syne Mono',monospace",marginTop:3 }}>Audited {ago(r.checkedAt)}</div>
                            </div>
                            <div style={{ width:100 }}><ConfidenceBar score={r.overallScore} /></div>
                            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:4 }}>
                              {Object.entries(r.agents||{}).map(([name,agQc])=>(
                                <div key={name} style={{ display:"flex",alignItems:"center",gap:4 }}>
                                  <div style={{ width:5,height:5,borderRadius:"50%",background:SEV[agQc.severity]?.color||"#94a3b8" }} />
                                  <span style={{ fontSize:9,color:"#2a3a50",fontFamily:"'Syne Mono',monospace" }}>{name.slice(0,5)}</span>
                                </div>
                              ))}
                            </div>
                            <span style={{ color:"#2a3a50",fontSize:12 }}>{isExp?"▴":"▾"}</span>
                          </div>
                          {isExp && (
                            <div style={{ padding:"0 18px 16px",borderTop:"1px solid rgba(255,255,255,0.05)",paddingTop:14,animation:"fu 0.2s ease" }}>
                              <div style={{ fontSize:12,color:"#6a7a8a",lineHeight:1.7,marginBottom:12 }}>{r.summary}</div>
                              {!r.clusterCorrect && (
                                <div style={{ padding:"8px 12px",borderRadius:8,background:`${QC_COLOR}0a`,border:`1px solid ${QC_COLOR}1a`,marginBottom:12 }}>
                                  <div style={{ fontSize:10,color:QC_COLOR,fontFamily:"'Syne Mono',monospace",marginBottom:4 }}>CLUSTER MISMATCH</div>
                                  <div style={{ fontSize:11,color:"#7a6a5a" }}>{r.clusterNote}</div>
                                  {r.suggestedCluster && <div style={{ fontSize:11,color:`${QC_COLOR}99`,marginTop:3 }}>Suggested: "{r.suggestedCluster}"</div>}
                                </div>
                              )}
                              <div style={{ display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8 }}>
                                {Object.entries(r.agents||{}).map(([name,agQc])=>(
                                  <div key={name} style={{ padding:"10px 12px",borderRadius:9,background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)" }}>
                                    <div style={{ display:"flex",justifyContent:"space-between",marginBottom:8 }}>
                                      <span style={{ fontSize:10,color:"#4a5a75",fontFamily:"'Syne Mono',monospace",textTransform:"uppercase" }}>{name}</span>
                                      <QCBadge severity={agQc.severity} />
                                    </div>
                                    {[["Accuracy",agQc.accuracy],["Relevance",agQc.relevance],["Quality",agQc.quality]].map(([l,v])=>(
                                      <div key={l} style={{ display:"flex",alignItems:"center",gap:6,marginBottom:4 }}>
                                        <span style={{ fontSize:9,color:"#2a3a50",fontFamily:"'Syne Mono',monospace",width:52 }}>{l}</span>
                                        <ConfidenceBar score={v||0} />
                                      </div>
                                    ))}
                                    {agQc.issues?.map((iss,i)=><div key={i} style={{ fontSize:10,color:"#5a6a7a",marginBottom:2,lineHeight:1.4,marginTop:4 }}>• {iss}</div>)}
                                    {agQc.suggestion && <div style={{ fontSize:10,color:`${QC_COLOR}88`,fontStyle:"italic",marginTop:4 }}>→ {agQc.suggestion}</div>}
                                  </div>
                                ))}
                              </div>
                              <button onClick={()=>{setSelectedId(r.thoughtId);setTab("thoughts");}}
                                style={{ marginTop:12,padding:"6px 14px",borderRadius:7,border:`1px solid ${QC_COLOR}30`,background:`${QC_COLOR}0a`,color:QC_COLOR,fontSize:11,fontFamily:"'Syne Mono',monospace" }}>
                                View Full Thought →
                              </button>
                            </div>
                          )}
                        </Panel>
                      );
                    })}
                  </div>
                </div>
              )}
              {qcReports.length===0 && !sweep && (
                <div style={{ textAlign:"center",color:"#1e2a3a",paddingTop:60 }}>
                  <div style={{ fontSize:38,marginBottom:14,color:`${QC_COLOR}44` }}>⊛</div>
                  <div style={{ fontFamily:"'Syne Mono',monospace",fontSize:11,marginBottom:8,color:"#2a3a50" }}>QC agent hasn't run yet</div>
                  <div style={{ fontSize:11,color:"#1a2230" }}>Capture a thought to trigger automatic QC, or run a full sweep above</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
