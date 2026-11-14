/**
 * Le site public : une page par avis, les analyses standard derrière une « porte »
 * qui mesure l'envie de payer, et un tableau de bord.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import { marked } from "marked";
import { randomBytes } from "node:crypto";
import type { Db } from "./db.js";
import type { Market, SolveOutput } from "./market.js";
import type { Config } from "./config.js";
import { STANDARD_QUESTIONS } from "./seeder.js";

type Ctx = { db: Db; market: Market; cfg: Config };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const md = (s: string) => marked.parse(esc(s), { async: false }) as string;
const euro = (micro: number) => (micro / 1e6).toFixed(2).replace(".", ",") + " €";
const date = (s: string) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "—");

function layout(cfg: Config, title: string, body: string, opts: { description?: string; canonical?: string } = {}) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Déjà</title>
<meta name="description" content="${esc(opts.description ?? "Analyses d'appels d'offres publics, déjà pensées. Résumé, conditions, dates clés, faisabilité PME.")}">
${opts.canonical ? `<link rel="canonical" href="${esc(opts.canonical)}">` : ""}
<style>
:root{--ink:#111827;--mute:#6b7280;--line:#e5e7eb;--acc:#4f46e5;--acc2:#16a34a;--bg:#fafafa;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);line-height:1.5}
header{background:#fff;border-bottom:1px solid var(--line)}header .in{max-width:900px;margin:auto;padding:14px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px}
a{color:var(--acc);text-decoration:none}a:hover{text-decoration:underline}
.brand{font-weight:800;font-size:20px;color:var(--ink)}.brand small{font-weight:400;color:var(--mute);font-size:13px;margin-left:8px}
main{max-width:900px;margin:auto;padding:22px 18px}
h1{font-size:26px;line-height:1.2;margin:0 0 6px}h2{font-size:18px;margin:26px 0 10px}
.mute{color:var(--mute);font-size:14px}.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:12px 0}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.btn{display:inline-block;background:var(--acc);color:#fff;border:0;border-radius:8px;padding:10px 16px;font:inherit;font-weight:600;cursor:pointer}.btn:hover{text-decoration:none;filter:brightness(1.08)}
.btn.ghost{background:transparent;color:var(--acc);border:1px solid var(--acc)}
.badge{font-size:12px;padding:2px 9px;border-radius:999px;background:#eef2ff;color:var(--acc)}.badge.ok{background:#dcfce7;color:var(--acc2)}
input[type=text],textarea{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:8px}
.teaser{position:relative;max-height:120px;overflow:hidden}.teaser:after{content:"";position:absolute;inset:auto 0 0 0;height:70px;background:linear-gradient(transparent,#fff)}
.analysis h1,.analysis h2,.analysis h3{font-size:16px;margin:12px 0 6px}.analysis ul{padding-left:20px}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left}th{color:var(--mute);font-weight:600}
.kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.kpi .card{margin:0}.kpi b{font-size:26px;display:block}
footer{max-width:900px;margin:30px auto;padding:0 18px;color:var(--mute);font-size:12px}
</style></head><body>
<header><div class="in"><a class="brand" href="/">Déjà <small>la bourse du raisonnement</small></a><a class="mute" href="/">Appels d'offres</a></div></header>
<main>${body}</main>
<footer>Données : BOAMP / Direction de l'information légale et administrative, réutilisées sous Licence Ouverte 2.0. Les analyses sont produites par une IA et peuvent contenir des erreurs : vérifiez toujours sur l'avis officiel. Déjà est un projet MistelGeehrt.</footer>
</body></html>`;
}

export function registerWeb(app: FastifyInstance, ctx: Ctx) {
  const { db, market, cfg } = ctx;
  app.register(cookie);

  /** Identifiant anonyme de visiteur (cookie), pour compter les visiteurs uniques et les « possessions ». */
  const visitor = (req: FastifyRequest, reply: FastifyReply) => {
    let v = req.cookies?.deja_v;
    if (!v || !/^v_[a-f0-9]{16}$/.test(v)) {
      v = "v_" + randomBytes(8).toString("hex");
      reply.setCookie("deja_v", v, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    }
    return v;
  };
  const unlocked = (req: FastifyRequest): Set<string> => new Set((req.cookies?.deja_u ?? "").split(",").filter(Boolean));
  const remember = (reply: FastifyReply, set: Set<string>) =>
    reply.setCookie("deja_u", [...set].slice(-60).join(","), { path: "/", maxAge: 60 * 60 * 24 * 30, sameSite: "lax" });

  // ---------- Accueil ----------
  app.get<{ Querystring: { q?: string } }>("/", async (req, reply) => {
    visitor(req, reply);
    const q = (req.query.q ?? "").trim();
    const docs = q ? db.docSearch(q) : db.docRecent(40);
    const list = docs
      .map(
        (d) => `<div class="card"><a href="/avis/${esc(d.id)}"><strong>${esc(d.title)}</strong></a>
        <div class="mute">${esc(d.buyer)} · publié le ${date(d.published)} · limite ${date(d.deadline)}</div></div>`
      )
      .join("");
    reply.type("text/html");
    return layout(
      cfg,
      "Appels d'offres publics, déjà analysés",
      `<h1>Un appel d'offres, quatre réponses déjà prêtes.</h1>
      <p class="mute">Chaque avis publié au BOAMP est lu une fois par notre agent. Résumé, conditions, dates clés, faisabilité pour une PME : vous ne payez que la réutilisation, quelques centimes, au lieu de refaire l'analyse.</p>
      <form method="get" action="/" class="row"><input type="text" name="q" value="${esc(q)}" placeholder="Rechercher un objet de marché ou un acheteur…" style="flex:1"><button class="btn">Chercher</button></form>
      <h2>${q ? `Résultats pour « ${esc(q)} »` : "Derniers avis analysés"}</h2>
      ${list || `<p class="mute">Rien pour l'instant. Le semeur n'a pas encore tourné.</p>`}`
    );
  });

  // ---------- Page d'un avis ----------
  const renderAnalysis = (r: { fingerprint: string; task: string; result: string; reuse_count: number }, isUnlocked: boolean, docId: string, near = false) => {
    const body = isUnlocked
      ? `<div class="analysis">${md(r.result)}</div><p class="mute">Bêta : cette analyse vous est offerte aujourd'hui. Le paiement en centimes arrivera avec l'extension.</p>`
      : `<div class="teaser analysis">${md(r.result.slice(0, 500))}</div>
         <form method="post" action="/avis/${esc(docId)}/debloquer" class="row" style="margin-top:10px">
           <input type="hidden" name="fingerprint" value="${esc(r.fingerprint)}">
           <button class="btn">Débloquer pour ${euro(cfg.priceMicroUsdc)}</button>
           <span class="mute">au lieu de refaire l'analyse</span></form>`;
    return `<div class="card"><div class="row"><span class="badge ${isUnlocked ? "ok" : ""}">${isUnlocked ? "Débloqué" : "Déjà pensé"}${near ? " (question proche)" : ""}</span>
      <strong>${esc(r.task)}</strong>${r.reuse_count ? `<span class="mute">réutilisé ${r.reuse_count} fois</span>` : ""}</div>${body}</div>`;
  };

  const avisPage = (req: FastifyRequest, reply: FastifyReply, id: string, extra = "") => {
    const d = db.docGet(id);
    if (!d) return reply.code(404).type("text/html").send(layout(cfg, "Avis introuvable", `<h1>Avis introuvable</h1><p><a href="/">Retour</a></p>`));
    const v = visitor(req, reply);
    // Les robots (Google, scrapers…) ne comptent pas comme visiteurs.
    const ua = String(req.headers["user-agent"] ?? "");
    if (!/bot|crawl|spider|slurp|fetch|preview|scan|monitor|curl|wget|python|go-http|headless/i.test(ua)) db.logEvent("view", { wallet: v, docId: id });
    const u = unlocked(req);
    const standard = db.byDoc(id).filter((r) => STANDARD_QUESTIONS.includes(r.task));
    const others = db.byDoc(id).filter((r) => !STANDARD_QUESTIONS.includes(r.task));
    const cards = standard.map((r) => renderAnalysis(r, u.has(r.fingerprint) || r.seller_wallet === v, id)).join("");
    const otherCards = others.length
      ? `<h2>Questions posées par d'autres</h2>` + others.map((r) => renderAnalysis(r, u.has(r.fingerprint) || r.seller_wallet === v, id)).join("")
      : "";
    reply.type("text/html");
    return layout(
      cfg,
      d.title,
      `<p class="mute"><a href="/">← Appels d'offres</a></p>
      <h1>${esc(d.title)}</h1>
      <p class="mute">${esc(d.buyer)} · publié le ${date(d.published)} · date limite ${date(d.deadline)} · <a href="${esc(d.url)}" rel="nofollow">avis officiel ↗</a></p>
      ${extra}
      <h2>Posez votre question sur cet avis</h2>
      <form method="post" action="/avis/${esc(id)}/question" class="card">
        <textarea name="task" rows="2" placeholder="Ex. : quel est le délai d'exécution ? faut-il un certificat Qualibat ?" required></textarea>
        <div class="row" style="margin-top:8px"><button class="btn">Demander</button><span class="mute">Si quelqu'un l'a déjà posée, la réponse est immédiate.</span></div>
      </form>
      ${cards ? `<h2>Analyses déjà pensées</h2>${cards}` : `<p class="mute">Les analyses standard de cet avis ne sont pas encore produites.</p>`}
      ${otherCards}`,
      { description: `Analyse de l'avis ${d.id} : ${d.title}. Acheteur : ${d.buyer}. Date limite : ${date(d.deadline)}.`, canonical: `${cfg.publicUrl}/avis/${d.id}` }
    );
  };

  app.get<{ Params: { id: string } }>("/avis/:id", async (req, reply) => avisPage(req, reply, req.params.id));

  // La « porte » : un clic = une intention de payer, puis on offre la réponse.
  app.post<{ Params: { id: string }; Body: { fingerprint?: string } }>("/avis/:id/debloquer", async (req, reply) => {
    const v = visitor(req, reply);
    const fp = req.body?.fingerprint ?? "";
    const r = db.find(fp);
    if (r) {
      db.logEvent("paywall_click", { fingerprint: fp, wallet: v, docId: req.params.id });
      const u = unlocked(req);
      u.add(fp);
      remember(reply, u);
    }
    return reply.redirect(`/avis/${encodeURIComponent(req.params.id)}#${fp.slice(0, 8)}`, 303);
  });

  // Une question libre sur un avis.
  app.post<{ Params: { id: string }; Body: { task?: string } }>("/avis/:id/question", async (req, reply) => {
    const v = visitor(req, reply);
    const task = (req.body?.task ?? "").trim().slice(0, 500);
    const id = req.params.id;
    if (!task || !db.docGet(id)) return reply.redirect(`/avis/${encodeURIComponent(id)}`, 303);
    let out: SolveOutput;
    try {
      out = await market.solve({ task, docId: id, requester: v });
    } catch (e) {
      return avisPage(req, reply, id, `<div class="card">Désolé, l'agent n'a pas pu répondre : ${esc((e as Error).message)}</div>`);
    }
    let extra = "";
    if (out.status === "created")
      extra = `<div class="card"><div class="row"><span class="badge">Nouveau</span><strong>${esc(out.task)}</strong></div><div class="analysis">${md(out.result)}</div>
        <p class="mute">Vous êtes le premier à poser cette question : l'analyse est à vous, gratuitement. Si d'autres la réutilisent, elle leur sera vendue ${euro(cfg.priceMicroUsdc)}.</p></div>`;
    else if (out.status === "owned")
      extra = `<div class="card"><div class="row"><span class="badge ok">À vous</span><strong>${esc(out.task)}</strong></div><div class="analysis">${md(out.result)}</div></div>`;
    else extra = renderAnalysis({ fingerprint: out.fingerprint, task: out.task, result: out.preview + "…", reuse_count: out.reuse_count }, false, id, !!out.near);
    return avisPage(req, reply, id, `<h2>Votre question</h2>${extra}`);
  });

  // ---------- SEO ----------
  app.get("/robots.txt", async (_req, reply) => reply.type("text/plain").send(`User-agent: *\nAllow: /\nDisallow: /tableau\nSitemap: ${cfg.publicUrl}/sitemap.xml\n`));
  app.get("/sitemap.xml", async (_req, reply) => {
    const urls = db.docAll().map((d) => `<url><loc>${cfg.publicUrl}/avis/${esc(d.id)}</loc><lastmod>${esc(d.published || "")}</lastmod></url>`);
    reply.type("application/xml");
    return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${cfg.publicUrl}/</loc></url>${urls.join("")}</urlset>`;
  });

  // ---------- Tableau de bord ----------
  app.get<{ Querystring: { cle?: string } }>("/tableau", async (req, reply) => {
    if (cfg.dashboardKey && req.query.cle !== cfg.dashboardKey) return reply.code(401).type("text/html").send(layout(cfg, "Accès", `<h1>Tableau de bord</h1><p>Ajoutez <code>?cle=…</code> à l'adresse.</p>`));
    const s = db.stats();
    const pct = (x: number) => (x * 100).toFixed(1).replace(".", ",") + " %";
    const a = s.agents;
    const verdict =
      a.agents < 20
        ? `<span class="badge">Pas encore assez d'agents distincts (${a.agents}/20) pour conclure.</span>`
        : a.payment_required >= 30 && a.pay_rate < 0.05
          ? `<span class="badge" style="background:#fee2e2;color:#b91c1c">Les agents ne paient pas quand on le leur demande (${pct(a.pay_rate)}).</span>`
          : a.payment_required >= 30 && a.pay_rate >= 0.15
            ? `<span class="badge ok">Les agents paient (${pct(a.pay_rate)}) : passer à l'étape 3.</span>`
            : `<span class="badge">Agents présents, paiements encore trop peu sollicités (${a.payment_required}/30) pour trancher.</span>`;
    const verdictHumans =
      s.asks < 200
        ? `<span class="badge">Pas encore assez de questions (${s.asks}/200) pour conclure.</span>`
        : s.paywall_click_rate < 0.05
          ? `<span class="badge" style="background:#fee2e2;color:#b91c1c">Moins de 5 % de clics « payer » : personne ne veut payer.</span>`
          : s.paywall_click_rate >= 0.15
            ? `<span class="badge ok">Plus de 15 % de clics « payer » : brancher le vrai paiement.</span>`
            : `<span class="badge">Entre 5 et 15 % : zone grise, continuer à mesurer.</span>`;
    const days = s.by_day
      .map((d) => `<tr><td>${esc(String(d.day))}</td><td>${d.views}</td><td>${d.asks}</td><td>${d.hits}</td><td>${d.near_hits}</td><td>${d.misses}</td><td>${d.paywall_clicks}</td></tr>`)
      .join("");
    const qs = s.recent_questions.map((q) => `<tr><td>${esc(q.created_at)}</td><td>${esc(q.doc_id ?? "")}</td><td>${esc(q.task)}</td><td>${esc(q.outcome)}</td></tr>`).join("");
    reply.type("text/html");
    return layout(
      cfg,
      "Tableau de bord",
      `<h1>Tableau de bord</h1><p>${verdict}</p><p class="mute">Vitrine humaine : ${verdictHumans}</p>
      <div class="kpi">
        <div class="card"><b>${s.visitors}</b><span class="mute">visiteurs uniques</span></div>
        <div class="card"><b>${s.asks}</b><span class="mute">questions posées</span></div>
        <div class="card"><b>${pct(s.duplicate_rate)}</b><span class="mute">taux de doublon exact</span></div>
        <div class="card"><b>${pct(s.near_duplicate_rate)}</b><span class="mute">doublons + quasi-doublons</span></div>
        <div class="card"><b>${pct(s.paywall_click_rate)}</b><span class="mute">clics « payer » sur devis</span></div>
        <div class="card"><b>${s.documents}</b><span class="mute">avis en base</span></div>
        <div class="card"><b>${s.reasonings}</b><span class="mute">analyses en vente</span></div>
        <div class="card"><b>${s.sales}</b><span class="mute">ventes payées (hors gratuites)</span></div>
      </div>
      <h2>Agents IA (le vrai test)</h2>
      <div class="kpi">
        <div class="card"><b>${s.agents.agents}</b><span class="mute">agents distincts</span></div>
        <div class="card"><b>${s.agents.agent_calls}</b><span class="mute">appels d'agents</span></div>
        <div class="card"><b>${pct(s.agents.return_rate)}</b><span class="mute">agents revenus un autre jour</span></div>
        <div class="card"><b>${s.agents.agent_publishes}</b><span class="mute">raisonnements publiés par des agents</span></div>
        <div class="card"><b>${s.agents.payment_required}</b><span class="mute">paiements demandés (402)</span></div>
        <div class="card"><b>${pct(s.agents.pay_rate)}</b><span class="mute">taux de paiement à la demande</span></div>
      </div>
      <div class="card"><table><tr><th>Semaine</th><th>Agents</th><th>Appels</th><th>402</th><th>Payés</th></tr>${
        s.agents.by_week.map((w) => `<tr><td>${esc(String(w.week))}</td><td>${w.agents}</td><td>${w.calls}</td><td>${w.required}</td><td>${w.paid}</td></tr>`).join("") || "<tr><td colspan=5 class=mute>Aucun agent encore</td></tr>"
      }</table></div>
      <h2>Humains sur le site (vitrine)</h2>
      <h2>Par jour</h2><div class="card"><table><tr><th>Jour</th><th>Vues</th><th>Questions</th><th>Doublons</th><th>Quasi</th><th>Nouvelles</th><th>Clics payer</th></tr>${days || "<tr><td colspan=7 class=mute>Rien encore</td></tr>"}</table></div>
      <h2>Dernières questions</h2><div class="card"><table><tr><th>Quand</th><th>Avis</th><th>Question</th><th>Issue</th></tr>${qs || "<tr><td colspan=4 class=mute>Rien encore</td></tr>"}</table></div>
      <p class="mute">Données brutes : <a href="/stats">/stats</a></p>`
    );
  });
}
