import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  Download,
  Loader2,
  ScanSearch,
  ShieldCheck,
  Users,
} from "lucide-react";
import { FileDrop } from "@/components/FileDrop";
import { exportAnomalies } from "@/lib/export-xlsx";
import type { AnalysisResult, AnomalyType } from "@/lib/analysis-types";
import type { TransferProposal } from "@/lib/transfers";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Contrôle Brouillard — Détection des écritures non soldées" },
      {
        name: "description",
        content:
          "Analysez le brouillard comptable et détectez les écritures qui empêchent les vérifications appel de fonds / trésorerie d'être soldées.",
      },
      { property: "og:title", content: "Contrôle Brouillard — Écritures non soldées" },
      {
        property: "og:description",
        content:
          "Rapprochement automatique appel de fonds / trésorerie par client, avec détail des écritures à corriger.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const TYPE_LABEL: Record<AnomalyType, string> = {
  mauvais_client: "Mauvais client",
  hors_perimetre: "Hors périmètre",
  compte_oublie: "Compte oublié",
};

const fmt = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Index() {
  const [brouillard, setBrouillard] = useState<File | null>(null);
  const [verif, setVerif] = useState<File | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [tab, setTab] = useState<"clients" | "ecritures" | "transferts">("clients");
  const [open, setOpen] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<AnomalyType | "tous">("tous");
  const [filterClient, setFilterClient] = useState<string>("tous");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(100);

  const run = async () => {
    if (!brouillard || !verif) return;
    setError(null);
    setResult(null);
    setStep("Chargement des fichiers…");
    try {
      const [b, v] = await Promise.all([brouillard.arrayBuffer(), verif.arrayBuffer()]);
      const worker = new Worker(new URL("../workers/analysis.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (e: MessageEvent) => {
        const d = e.data;
        if (d.type === "progress") setStep(d.step);
        if (d.type === "error") {
          setError(d.message);
          setStep(null);
          worker.terminate();
        }
        if (d.type === "done") {
          setResult(d.result as AnalysisResult);
          setStep(null);
          worker.terminate();
        }
      };
      worker.postMessage({ brouillard: b, verif: v }, [b, v]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep(null);
    }
  };

  const anomalies = useMemo(() => {
    if (!result) return [];
    const q = search.trim().toLowerCase();
    return result.anomalies.filter(
      (a) =>
        (filterType === "tous" || a.type === filterType) &&
        (filterClient === "tous" || a.entite === filterClient) &&
        (!q ||
          a.libelle.toLowerCase().includes(q) ||
          a.piece.toLowerCase().includes(q) ||
          a.comptes.toLowerCase().includes(q) ||
          a.entite.toLowerCase().includes(q)),
    );
  }, [result, filterType, filterClient, search]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-5 py-10">
      <header className="mb-10">
        <div className="rule-strip mb-6 h-1.5 w-28 rounded-full" />
        <p className="num text-xs uppercase tracking-[0.25em] text-muted-foreground">
          Contrôle comptable · Appel de fonds / Trésorerie
        </p>
        <h1 className="mt-2 text-4xl font-bold sm:text-5xl">
          Détecteur d'écritures non soldées
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Déposez le brouillard et la feuille de vérification : l'application recalcule chaque
          contrôle client et isole les écritures qui empêchent le solde d'être à zéro.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <FileDrop
          label="Brouillard des écritures"
          hint="BROUILLARD_2026….xlsx — toutes les lignes comptables"
          file={brouillard}
          onFile={setBrouillard}
        />
        <FileDrop
          label="Feuille de vérification"
          hint="Verif_BG….xlsx — comptes contrôlés par client"
          file={verif}
          onFile={setVerif}
        />
      </section>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          onClick={run}
          disabled={!brouillard || !verif || !!step}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {step ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" />}
          {step ?? "Lancer l'analyse"}
        </button>
        {result && (
          <button
            onClick={() => exportAnomalies(result)}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm font-semibold transition-colors hover:border-accent"
          >
            <Download className="size-4" /> Export Excel
          </button>
        )}
      </div>

      {error && (
        <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {result && (
        <>
          <section className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              icon={<Users className="size-4" />}
              label="Clients contrôlés"
              value={String(result.stats.entites)}
              sub={`${result.stats.lignes.toLocaleString("fr-FR")} lignes analysées`}
            />
            <Stat
              icon={<ShieldCheck className="size-4" />}
              label="Contrôles soldés"
              value={`${result.stats.soldees} / ${result.stats.entites}`}
              sub="Écart inférieur à 0,01"
              tone="success"
            />
            <Stat
              icon={<AlertTriangle className="size-4" />}
              label="Écritures suspectes"
              value={result.anomalies.length.toLocaleString("fr-FR")}
              sub={`${result.stats.parType.mauvais_client} mauvais client · ${result.stats.parType.hors_perimetre} hors périmètre · ${result.stats.parType.compte_oublie} comptes oubliés`}
              tone="warning"
            />
            <Stat
              icon={<ArrowRight className="size-4" />}
              label="Écart total (valeur absolue)"
              value={fmt(result.stats.ecartTotal)}
              sub="Somme des écarts par client"
              tone="destructive"
            />
          </section>

          <div className="mt-8 flex gap-1 border-b border-border">
            {(["clients", "ecritures", "transferts"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
                  tab === t
                    ? "border-accent text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "clients"
                  ? "Tableau de bord par client"
                  : t === "ecritures"
                    ? "Écritures à corriger"
                    : `Comptes à comptes (${result.transferts.filter((x) => x.statut === "a_creer").length})`}
              </button>
            ))}
          </div>

          {tab === "clients" ? (
            <section className="mt-6 space-y-2">
              {result.entites.map((e) => {
                const solde = Math.abs(e.ecart) < 0.01;
                const isOpen = open === e.suffixe + e.nom;
                return (
                  <div key={e.suffixe + e.nom} className="panel overflow-hidden">
                    <button
                      onClick={() => setOpen(isOpen ? null : e.suffixe + e.nom)}
                      className="grid w-full grid-cols-2 items-center gap-3 px-4 py-3 text-left hover:bg-secondary/60 md:grid-cols-[1.6fr_repeat(3,1fr)_auto]"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`size-2 rounded-full ${solde ? "bg-success" : "bg-destructive"}`}
                        />
                        <div>
                          <p className="font-semibold">{e.nom}</p>
                          <p className="num text-xs text-muted-foreground">
                            suffixe {e.suffixe} · {e.anomalies} anomalie(s)
                          </p>
                        </div>
                      </div>
                      <Cell label="Appel de fonds" value={e.appelDeFonds} />
                      <Cell label="Trésorerie" value={e.tresorerie} />
                      <Cell label="Écart" value={e.ecart} strong />
                      <ChevronDown
                        className={`hidden size-4 text-muted-foreground transition-transform md:block ${isOpen ? "rotate-180" : ""}`}
                      />
                    </button>
                    {isOpen && (
                      <div className="border-t border-border bg-secondary/40 px-4 py-3">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Comptes du client
                        </p>
                        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                          {e.comptes.map((c) => (
                            <div
                              key={c.compte}
                              className="flex items-center justify-between rounded-md bg-card px-3 py-1.5 text-sm"
                            >
                              <span className="num">
                                {c.compte}
                                {!c.listeVerif && (
                                  <span className="ml-2 rounded bg-warning/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-accent-foreground">
                                    hors contrôle
                                  </span>
                                )}
                              </span>
                              <span className="num">{fmt(c.solde)}</span>
                            </div>
                          ))}
                        </div>
                        <button
                          onClick={() => {
                            setTab("ecritures");
                            setFilterClient(e.nom);
                            setFilterType("tous");
                            setLimit(100);
                          }}
                          className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-accent-foreground underline decoration-accent underline-offset-4"
                        >
                          Voir les écritures à corriger <ArrowRight className="size-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          ) : tab === "transferts" ? (
            <Transferts result={result} />
          ) : (
            <section className="mt-6">
              <div className="mb-4 flex flex-wrap gap-3">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher un libellé, une pièce, un compte…"
                  className="min-w-56 flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent"
                />
                <select
                  value={filterClient}
                  onChange={(e) => setFilterClient(e.target.value)}
                  className="rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent"
                >
                  <option value="tous">Tous les clients</option>
                  {result.entites.map((e) => (
                    <option key={e.nom + e.suffixe} value={e.nom}>
                      {e.nom}
                    </option>
                  ))}
                </select>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value as AnomalyType | "tous")}
                  className="rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent"
                >
                  <option value="tous">Tous les types</option>
                  {Object.entries(TYPE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              <p className="mb-3 text-sm text-muted-foreground">
                {anomalies.length.toLocaleString("fr-FR")} écriture(s) détectée(s)
              </p>

              <div className="panel divide-y divide-border">
                {anomalies.slice(0, limit).map((a) => (
                  <div key={a.id} className="grid gap-2 px-4 py-3 md:grid-cols-[auto_1fr_auto]">
                    <span
                      className={`h-fit rounded px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                        a.type === "mauvais_client"
                          ? "bg-destructive/12 text-destructive"
                          : a.type === "hors_perimetre"
                            ? "bg-warning/20 text-accent-foreground"
                            : "bg-primary/10 text-primary"
                      }`}
                    >
                      {TYPE_LABEL[a.type]}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {a.entite}
                        {a.journal && (
                          <span className="num ml-2 font-normal text-muted-foreground">
                            {a.journal} · pièce {a.piece} · {a.date}
                          </span>
                        )}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">{a.libelle}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{a.detail}</p>
                      <p className="num mt-1 text-xs text-muted-foreground">{a.comptes}</p>
                    </div>
                    <span
                      className={`num h-fit text-right text-sm font-semibold ${a.montant < 0 ? "text-destructive" : ""}`}
                    >
                      {fmt(a.montant)}
                    </span>
                  </div>
                ))}
                {anomalies.length === 0 && (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Aucune écriture ne correspond à ces filtres.
                  </p>
                )}
              </div>

              {anomalies.length > limit && (
                <button
                  onClick={() => setLimit((l) => l + 200)}
                  className="mt-4 w-full rounded-md border border-border bg-card py-2.5 text-sm font-semibold hover:border-accent"
                >
                  Afficher plus ({anomalies.length - limit} restantes)
                </button>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone?: "success" | "warning" | "destructive";
}) {
  const color =
    tone === "success"
      ? "text-success"
      : tone === "destructive"
        ? "text-destructive"
        : tone === "warning"
          ? "text-accent-foreground"
          : "text-foreground";
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className={`num mt-2 text-2xl font-bold ${color}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

function Cell({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={`num text-sm ${strong ? "font-bold" : ""} ${
          strong && Math.abs(value) >= 0.01 ? "text-destructive" : ""
        }`}
      >
        {fmt(value)}
      </p>
    </div>
  );
}

const OP_LABEL: Record<TransferProposal["type"], string> = {
  appel_de_fonds: "Appel de fonds",
  paiement: "Paiement",
  honoraires: "Honoraires",
};
const ST_LABEL: Record<TransferProposal["statut"], string> = {
  a_creer: "À créer",
  existe_deja: "Déjà passée",
  manuel: "À traiter manuellement",
};

function Transferts({ result }: { result: AnalysisResult }) {
  const [statut, setStatut] = useState<TransferProposal["statut"] | "tous">("a_creer");
  const [type, setType] = useState<TransferProposal["type"] | "tous">("tous");
  const [limit, setLimit] = useState(100);
  const list = result.transferts.filter(
    (t) => (statut === "tous" || t.statut === statut) && (type === "tous" || t.type === type),
  );
  const sel = "rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent";
  return (
    <section className="mt-6">
      <div className="mb-4 flex flex-wrap gap-3">
        <select value={statut} onChange={(e) => { setStatut(e.target.value as never); setLimit(100); }} className={sel}>
          <option value="tous">Tous les statuts</option>
          {Object.entries(ST_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={type} onChange={(e) => { setType(e.target.value as never); setLimit(100); }} className={sel}>
          <option value="tous">Toutes les opérations</option>
          {Object.entries(OP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        {list.length.toLocaleString("fr-FR")} écriture(s) de compte à compte via 580001
      </p>
      <div className="panel divide-y divide-border">
        {list.slice(0, limit).map((t) => (
          <div key={t.id} className="grid gap-2 px-4 py-3 md:grid-cols-[1fr_auto]">
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                {OP_LABEL[t.type]} · {t.entite}
                <span className="num ml-2 font-normal text-muted-foreground">
                  {t.journalDestination} · pièce {t.piece} · {t.date}
                </span>
              </p>
              <p className="truncate text-sm text-muted-foreground">{t.libelle}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t.motif}</p>
              {t.envoyeur.length > 0 && (
                <div className="num mt-2 grid gap-1 text-xs sm:grid-cols-2">
                  <div className="rounded bg-secondary/60 px-2 py-1">
                    Envoyeur ({t.journalSource}) : {t.envoyeur.map((l) => `${l.compte} ${l.sens}`).join(" / ")}
                  </div>
                  <div className="rounded bg-secondary/60 px-2 py-1">
                    Réceptionnaire ({t.journalDestination}) : {t.receptionnaire.map((l) => `${l.compte} ${l.sens}`).join(" / ")}
                  </div>
                </div>
              )}
            </div>
            <div className="text-right">
              <p className="num text-sm font-semibold">{fmt(t.montant)}</p>
              <p className={`mt-1 text-[11px] font-semibold uppercase ${t.statut === "a_creer" ? "text-destructive" : t.statut === "manuel" ? "text-accent-foreground" : "text-success"}`}>
                {ST_LABEL[t.statut]}
              </p>
            </div>
          </div>
        ))}
        {list.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Aucune écriture pour ces filtres.</p>
        )}
      </div>
      {list.length > limit && (
        <button onClick={() => setLimit((l) => l + 200)} className="mt-4 w-full rounded-md border border-border bg-card py-2.5 text-sm font-semibold hover:border-accent">
          Afficher plus ({list.length - limit} restantes)
        </button>
      )}
    </section>
  );
}
