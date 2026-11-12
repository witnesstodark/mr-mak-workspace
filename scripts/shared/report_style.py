"""
Shared HTML report style for all Mr. Mak reports.

"Luminous Mak" design system — tokens mirrored from src/styles/tokens.css:
near-black bg (#0a0a0c) with a soft pink/purple aura, glass cards with
hairline borders, pink accent (#f0a0b0), Fraunces display serif for
headings, Inter body, JetBrains Mono for code.

Covers: KPI cards, tables, bar charts, image variants, video cards, tags,
badges, callouts, verdicts — plus the design-system `.mak-card` (glass card
with a pink→purple gradient edge) for hero/featured blocks:

    <div class="mak-card">
      <div class="eyebrow">Featured</div>
      <h2>Title</h2>
      <p>Body…</p>
    </div>

Old reports are untouched — CSS is baked into each file at generation time.
"""

REPORT_CSS = """
@font-face {
  font-family: 'Fraunces';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url('/fonts/font-066710ce7ed235a3.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face {
  font-family: 'Fraunces';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url('/fonts/font-4983926d3a16544e.woff2') format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
@font-face {
  font-family: 'Fraunces';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url('/fonts/font-23af38108404d4b0.woff2') format('woff2');
  unicode-range: U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB;
}
@font-face {
  font-family: 'Fraunces';
  font-style: italic;
  font-weight: 100 900;
  font-display: swap;
  src: url('/fonts/font-3100e775e8616cd2.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face {
  font-family: 'Fraunces';
  font-style: italic;
  font-weight: 100 900;
  font-display: swap;
  src: url('/fonts/font-7234ed860a9cc830.woff2') format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
@font-face {
  font-family: 'Fraunces';
  font-style: italic;
  font-weight: 100 900;
  font-display: swap;
  src: url('/fonts/font-34b9c504cab7a73e.woff2') format('woff2');
  unicode-range: U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB;
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url('/fonts/font-71d5ee93cc1e9f1d.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url('/fonts/font-1be3448e292fbf05.woff2') format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url('/fonts/font-ca157063339ac4ad.woff2') format('woff2');
  unicode-range: U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB;
}
@font-face {
  font-family: 'JetBrains Mono';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url('/fonts/font-5c66f9e07e90c6d4.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face {
  font-family: 'JetBrains Mono';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url('/fonts/font-f18853f63a870ebe.woff2') format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
@font-face {
  font-family: 'JetBrains Mono';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url('/fonts/font-6e9e020a25f9b56d.woff2') format('woff2');
  unicode-range: U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB;
}

:root {
  color-scheme: dark;
  --bg: #0a0a0c;
  --surface-1: rgba(255, 255, 255, 0.03);
  --surface-2: rgba(255, 255, 255, 0.055);
  --hairline: rgba(255, 255, 255, 0.08);
  --text: #ececf1;
  --text-bright: #ffffff;
  --text-dim: #9a9aa6;
  --text-muted: #5c5c68;
  --pink: #f0a0b0;
  --purple: #b794f4;
  --green: #6ee7a0;
  --amber: #eab56e;
  --blue: #7eb8ff;
  --red: #f48080;
  --edge: linear-gradient(135deg, rgba(240,160,176,0.38), rgba(183,148,244,0.22) 45%, rgba(255,255,255,0.07) 80%);
  --card-glass: linear-gradient(160deg, rgba(24,24,30,0.82), rgba(15,15,19,0.82));
  --radius-sm: 7px;
  --radius: 10px;
  --radius-lg: 14px;
  --font-body: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
  --font-display: 'Fraunces', Georgia, 'Times New Roman', serif;
  --font-mono: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
}

* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: var(--font-body);
  background: var(--bg); color: var(--text);
  padding: 32px 24px; line-height: 1.5;
}
/* Aura — soft pink/purple pools of light behind everything */
body::before {
  content: ''; position: fixed; inset: 0; z-index: -1; pointer-events: none;
  background:
    radial-gradient(520px 420px at 12% -4%, rgba(240,160,176,0.07), transparent 65%),
    radial-gradient(720px 560px at 96% 104%, rgba(183,148,244,0.055), transparent 65%);
}
.container { max-width: 1200px; margin: 0 auto; }

/* Typography */
h1 { font-family: var(--font-display); font-size: 1.7rem; margin-bottom: 4px; color: var(--text-bright); font-weight: 560; letter-spacing: 0.2px; }
h2 { font-family: var(--font-display); color: var(--text-bright); font-size: 1.2rem; margin: 32px 0 12px; font-weight: 540; border-bottom: 1px solid var(--hairline); padding-bottom: 8px; }
h3 { color: var(--text); font-size: 0.95rem; margin: 16px 0 8px; font-weight: 500; }
h4 { color: #c0c0c8; font-size: 0.85rem; margin: 12px 0 6px; font-weight: 500; }
p { margin-bottom: 8px; font-size: 0.9rem; }
ul, ol { margin: 6px 0 12px 22px; font-size: 0.9rem; }
li { margin-bottom: 4px; }
a { color: var(--pink); text-decoration: none; }
a:hover { text-decoration: underline; }
code { font-family: var(--font-mono); font-size: 0.82rem; background: #141417; padding: 1px 6px; border-radius: 3px; color: var(--amber); }
em { color: #c0c0c8; font-style: italic; }
strong { color: var(--text-bright); }
::selection { background: rgba(240,160,176,0.3); }
.meta, .subtitle { color: var(--text-dim); font-size: 0.82rem; margin-bottom: 20px; }

/* Design-system card — glass + pink→purple gradient edge */
.mak-card {
  border: 1px solid transparent; border-radius: var(--radius-lg);
  background: var(--card-glass) padding-box, var(--edge) border-box;
  box-shadow: 0 6px 24px rgba(0,0,0,0.4), 0 0 28px rgba(240,160,176,0.07);
  padding: 18px 20px; margin: 16px 0;
}
.mak-card > h2, .mak-card > h3 { border: 0; padding: 0; margin: 0 0 10px; font-family: var(--font-display); color: var(--text-bright); }
.mak-card .eyebrow { margin-bottom: 6px; }

/* KPI cards */
.kpi-grid, .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 24px; }
@media (max-width: 700px) { .kpi-grid, .kpis { grid-template-columns: repeat(2, 1fr); } }
.kpi {
  background: var(--surface-1); border: 1px solid var(--hairline); border-radius: var(--radius);
  padding: 16px; text-align: center;
}
.kpi-value { font-family: var(--font-display); font-size: 1.55rem; font-weight: 600; color: var(--text-bright); }
.kpi-label { font-size: 0.72rem; color: var(--text-dim); margin-top: 2px; text-transform: uppercase; letter-spacing: 0.5px; }
.kpi-green .kpi-value { color: var(--green); }
.kpi-blue .kpi-value { color: var(--blue); }
.kpi-yellow .kpi-value { color: var(--amber); }

/* Sections */
.section { margin-bottom: 28px; }
.section-label {
  font-size: 0.65rem; text-transform: uppercase; letter-spacing: 1.6px;
  color: var(--text-muted); margin: 24px 0 8px; padding-bottom: 4px; border-bottom: 1px solid var(--hairline);
}

/* Tables */
table { width: 100%; border-collapse: collapse; margin-top: 8px; margin-bottom: 16px; }
th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 0.82rem; }
th { color: var(--text-muted); font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 500; }
td { color: #b4b4be; }
td.num, th.num { text-align: right; }
tr:hover { background: rgba(255,255,255,0.02); }

/* Bar charts in tables */
.bar-bg { background: #1e1e22; border-radius: 3px; height: 6px; overflow: hidden; }
.bar-fill { background: linear-gradient(90deg, var(--pink), var(--purple)); height: 100%; border-radius: 3px; }

/* Cards */
.card, .obj-card, .video-card {
  background: var(--surface-1); border: 1px solid var(--hairline);
  border-radius: var(--radius); padding: 16px; margin-bottom: 12px;
}
.card.approved, .obj-card.approved { border-color: #3a6a3a; }
.card-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.card-num {
  background: rgba(240,160,176,0.12); color: var(--pink);
  width: 26px; height: 26px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 0.75rem; flex-shrink: 0;
}
.card-title, .video-title { font-size: 0.95rem; font-weight: 500; color: var(--text-bright); }
.card-category {
  display: inline-block; background: #111114; border: 1px solid var(--hairline);
  color: var(--purple); padding: 1px 7px; border-radius: 12px; font-size: 0.62rem;
}
.card-desc, .desc { color: var(--text-dim); font-size: 0.82rem; margin-top: 4px; }

/* Status badges */
.status, .badge {
  display: inline-block; padding: 1px 7px; border-radius: 4px;
  font-size: 0.62rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px;
}
.status.final, .badge-hot { background: rgba(110,231,160,0.1); color: var(--green); }
.status.edit { background: rgba(234,181,110,0.1); color: var(--amber); }
.status.regen, .badge-new { background: rgba(183,148,244,0.1); color: var(--purple); }
.badge-boosted { background: rgba(240,160,176,0.1); color: var(--pink); }

/* Engagement indicators */
.engagement-high { color: var(--green); }
.engagement-mid { color: var(--amber); }
.engagement-low { color: var(--text-dim); }

/* Image variants grid */
.variants { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.variants.two { grid-template-columns: repeat(2, 1fr); }
.variants.one { grid-template-columns: 1fr; max-width: 380px; }
@media (max-width: 900px) { .variants, .variants.two { grid-template-columns: 1fr; } }
.variant {
  background: #111114; border: 1px solid var(--hairline);
  border-radius: var(--radius-sm); overflow: hidden;
}
.var-label {
  background: #1e1e22; color: #b4b4be;
  padding: 4px 10px; font-weight: 500; font-size: 0.75rem;
}
.var-label.before { background: #1e1214; color: var(--red); }
.var-label.after { background: #121e14; color: var(--green); }
.variant img { width: 100%; display: block; }
.img-error { padding: 24px; text-align: center; color: var(--red); background: #14101a; font-size: 0.78rem; }
.prompt-text, .prompt-hint {
  padding: 8px 10px; font-size: 0.66rem; color: var(--text-muted);
  font-family: var(--font-mono);
  border-top: 1px solid #1e1e22; max-height: 56px; overflow-y: auto; line-height: 1.35;
}

/* Steps chain dots */
.steps-chain { display: flex; gap: 3px; margin-top: 6px; }
.step-dot { width: 6px; height: 6px; border-radius: 50%; background: #2a2a2e; }
.step-dot.done { background: var(--green); }

/* Tags */
.tag-list, .queries { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.tag, .query-tag {
  background: #111114; border: 1px solid var(--hairline);
  padding: 1px 7px; border-radius: 4px; font-size: 0.68rem; color: var(--green);
}
.tests h4 { color: var(--pink); font-size: 0.7rem; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.4px; }

/* Video card specifics */
.video-channel { color: var(--text-muted); font-size: 0.75rem; }
.video-terms { margin-top: 6px; }
.thumb { border-radius: 4px; max-width: 100%; }
.eyebrow { font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 4px; }

/* Stats row */
.stats { display: flex; gap: 16px; margin: 6px 0; }
.stat { font-size: 0.82rem; }
.stat-label { color: var(--text-muted); font-size: 0.68rem; }

/* Grid layouts */
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; }
@media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }

/* Hero section */
.hero { background: var(--surface-1); border: 1px solid var(--hairline); border-radius: var(--radius); padding: 18px; margin-bottom: 20px; }

/* Summary / rationale boxes */
.summary, .rationale { background: var(--surface-1); border: 1px solid var(--hairline); border-radius: var(--radius); padding: 16px; margin-bottom: 16px; }
.summary h2, .rationale h2 { color: var(--pink); font-size: 1rem; margin-bottom: 8px; border: 0; padding: 0; }
.rationale ul { padding-left: 16px; color: var(--text-dim); }
.rationale li { margin-bottom: 3px; font-size: 0.85rem; }
.rationale li strong { color: var(--text); }
.prev-note { color: var(--amber); font-size: 0.68rem; margin-top: 4px; }

/* Verdict / TL;DR block */
.verdict {
  background: linear-gradient(135deg, rgba(28,42,28,0.75), rgba(24,24,27,0.75));
  border: 1px solid #3a6a3a; border-radius: var(--radius-lg); padding: 20px; margin: 20px 0 30px;
  box-shadow: 0 0 28px rgba(110,231,160,0.06);
}
.verdict h2 { border: 0; padding: 0; margin: 0 0 12px; color: var(--green); font-size: 1.1rem; }
.verdict p { margin-bottom: 10px; font-size: 0.93rem; }
.verdict ul { margin: 6px 0 10px 22px; font-size: 0.9rem; }
.verdict li { margin-bottom: 4px; }
.verdict .win { color: var(--green); font-weight: 600; }
.verdict .lose { color: var(--red); font-weight: 600; }
.verdict .info { color: var(--blue); font-weight: 600; }

/* Callouts */
.callout { background: #161620; border: 1px solid #2a2a3e; border-left: 3px solid var(--blue); border-radius: var(--radius-sm); padding: 14px 16px; margin: 12px 0; font-size: 0.88rem; color: #c4c4cc; }
.callout strong { color: var(--text-bright); }
.callout.warn { border-left-color: var(--amber); }
.callout.bad { border-left-color: var(--red); }

/* Title-variant cards */
.title-card { background: var(--surface-1); border: 1px solid var(--hairline); border-radius: var(--radius); padding: 14px 16px; margin-bottom: 10px; }
.title-card.rec { border-color: #3a6a3a; background: linear-gradient(135deg, rgba(22,35,26,0.7), rgba(24,24,27,0.7)); }
.title-card .tnum { display: inline-block; background: rgba(110,231,160,0.12); color: var(--green); width: 24px; height: 24px; line-height: 24px; text-align: center; border-radius: 50%; font-weight: 700; font-size: 0.75rem; margin-right: 10px; vertical-align: middle; }
.title-card .ttext { font-size: 1rem; color: var(--text-bright); font-weight: 500; }
.title-card .tpat { display: inline-block; background: #141417; color: var(--amber); padding: 1px 6px; border-radius: 3px; font-size: 0.7rem; font-family: var(--font-mono); margin-left: 8px; vertical-align: middle; }
.title-card .trat { font-size: 0.78rem; color: var(--text-dim); margin-top: 6px; margin-left: 34px; }
.title-card.rec .tnum { background: rgba(110,231,160,0.25); color: var(--green); }

/* Check marks */
.check { color: var(--green); }

/* Footer */
.footer { text-align: center; color: #3a3a40; margin-top: 28px; font-size: 0.72rem; }

/* Scrollbar */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.09); border-radius: 4px; border: 2px solid transparent; background-clip: content-box; }
::-webkit-scrollbar-thumb:hover { background-color: rgba(255,255,255,0.18); }
"""


def wrap_html(title, body_html, subtitle=""):
    from pathlib import Path
    shared = Path(__file__).resolve().parents[2] / "workspace" / "_shared"
    # Inline the maintained assets so exported reports also work on their own.
    shared_css = (shared / "report.css").read_text(encoding="utf-8")
    shared_js = (shared / "report.js").read_text(encoding="utf-8")
    sub = f'<p class="meta">{subtitle}</p>' if subtitle else ""
    return f"""<!DOCTYPE html>
<html lang="en" data-mak-report="document">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<style>{REPORT_CSS}</style>
<style>{shared_css}</style>
<script defer>{shared_js}</script>
</head>
<body>
<div class="container">
<h1>{title}</h1>
{sub}
{body_html}
</div>
</body>
</html>"""
