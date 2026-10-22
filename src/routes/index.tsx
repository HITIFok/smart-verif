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
import { OPERATION_LABELS } from "@/lib/transfers";
import { CYCLE_CHAIN, SCHEMA_ECRITURES, SCHEMA_ANNULATION_PAIEMENT } from "@/lib/schema-ecritures";
import type { EtapeSchema } from "@/lib/schema-ecritures";
import { BANQUES_SOCIETES } from "@/lib/banques-societes";
import {
  avecLibelle,
  decrireCompte,
  decrireComptes,
  familleCompte,
  NB_COMPTES_PLAN,
  NB_TIERS_PLAN,
  PLAN_COMPTABLE,
  PLAN_TIERS,
} from "@/lib/referentiel";

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
  ecart_balance: "Écart brouillard / balance",
};

const fmt = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Index() {
  const [brouillard, setBrouillard] = useState<File | null>(null);
  const [verif, setVerif] = useState<File | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [tab, setTab] = useState<"clients" | "ecritures" | "transferts" | "schema" | "referentiel">(
    "clients",
  );
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
        <h1 className="mt-2 text-4xl font-bold sm:text-5xl">Détecteur d'écritures non soldées</h1>
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
          hint="Verif_BG….xlsx — blocs clients + balance des comptes"
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
            sub={`${result.stats.famillesSoldees} / ${result.stats.familles} familles soldées · écart < 0,01`}
            tone="success"
          />
          <Stat
            icon={<AlertTriangle className="size-4" />}
            label="Écritures suspectes"
            value={result.anomalies.length.toLocaleString("fr-FR")}
            sub={`${result.stats.parType.mauvais_client} mauvais client · ${result.stats.parType.hors_perimetre} hors périmètre · ${result.stats.parType.compte_oublie} comptes oubliés · ${result.stats.parType.ecart_balance} écarts balance`}
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
      )}

      <div className="mt-8 flex gap-1 overflow-x-auto border-b border-border">
        {(["clients", "ecritures", "transferts", "schema", "referentiel"] as const).map((t) => (
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
                : t === "transferts"
                  ? `Comptes à comptes (${result?.transferts.filter((x) => x.statut === "a_creer").length ?? 0})`
                  : t === "schema"
                    ? "Schéma des écritures"
                    : "Référentiel comptable"}
          </button>
        ))}
      </div>

      {tab === "schema" ? (
        <SchemaEcritures />
      ) : tab === "referentiel" ? (
        <Referentiel />
      ) : !result ? (
        <p className="panel mt-6 px-4 py-10 text-center text-sm text-muted-foreground">
          Déposez le brouillard et la feuille de vérification puis lancez l'analyse : le tableau de
          bord par client, les écritures à corriger et les comptes à comptes s'afficheront ici.
        </p>
      ) : tab === "clients" ? (
        <section className="mt-6 space-y-2">
          {result.familles.length > 0 && (
            <div className="panel overflow-hidden">
              <div className="border-b border-border px-4 py-3">
                <p className="text-sm font-semibold">Vérification par famille de clients</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Comme dans la feuille de vérification, les clients sans banque propre sont soldés
                  avec la banque de leur famille (ex. MGS avec le 512124 de FSS) : le contrôle est
                  concluant au niveau de la famille, pas forcément de chaque client isolé.
                </p>
              </div>
              <div className="divide-y divide-border">
                {result.familles.map((f) => (
                  <div
                    key={f.nom}
                    className="grid gap-2 px-4 py-2.5 text-sm md:grid-cols-[1.4fr_2fr_auto_auto_auto]"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`size-2 shrink-0 rounded-full ${f.soldee ? "bg-success" : "bg-destructive"}`}
                      />
                      <span className="font-semibold">{f.nom}</span>
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                        famille
                      </span>
                    </div>
                    <p className="self-center text-xs text-muted-foreground">
                      {f.membres.join(" + ")}
                    </p>
                    <span className="num self-center text-right text-xs text-muted-foreground">
                      appel {fmt(f.appelDeFonds)}
                      <br />
                      tréso {fmt(f.tresorerie)}
                    </span>
                    <span
                      className={`num self-center text-right font-semibold ${f.ecart < 0 ? "text-destructive" : ""}`}
                    >
                      {fmt(f.ecart)}
                    </span>
                    <span
                      className={`self-center rounded px-2 py-1 text-center text-[11px] font-semibold uppercase ${
                        f.soldee
                          ? "bg-success/15 text-success"
                          : "bg-destructive/10 text-destructive"
                      }`}
                    >
                      {f.soldee ? "Soldée" : "Écart"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
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
                      <p className="font-semibold">
                        {e.nom}
                        {e.famille && (
                          <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                            famille {e.famille}
                          </span>
                        )}
                      </p>
                      <p className="num text-xs text-muted-foreground">
                        suffixe {e.suffixe} · {e.anomalies} anomalie(s)
                        {e.famille && ` · soldé avec ${e.famille}`}
                        {!e.famille && e.enfants && ` · famille de ${e.enfants.length} client(s)`}
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
                          className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-card px-3 py-1.5 text-sm"
                        >
                          <span className="num flex min-w-0 items-center">
                            <span className="shrink-0">{c.compte}</span>
                            <span className="ml-2 truncate text-xs font-normal text-muted-foreground">
                              {decrireCompte(c.compte)}
                            </span>
                            {!c.listeVerif && (
                              <span className="ml-2 shrink-0 rounded bg-warning/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-accent-foreground">
                                hors contrôle
                              </span>
                            )}
                            {c.partage && (
                              <span className="ml-2 shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                                partagé
                              </span>
                            )}
                          </span>
                          <span className="num shrink-0">{fmt(c.solde)}</span>
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
                        : a.type === "ecart_balance"
                          ? "bg-warning/15 text-destructive"
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
                  <p className="num mt-1 text-xs text-muted-foreground">
                    {decrireComptes(a.comptes)}
                  </p>
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

function SchemaEcritures() {
  return (
    <section className="mt-6">
      <div className="panel p-5">
        <p className="text-sm font-semibold">Cycle complet de l'appel de fonds</p>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Le cycle se compose de quatre écritures équilibrées. L'écriture de l'appel de fonds se
          saisit dans TIERS (460 au Débit, 467 au Crédit). Le compte 401000 + compte tiers
          matérialise le paiement des prestataires ou clients : côté TIERS (467 au Débit, 401000 +
          compte tiers au Crédit) puis côté banque (401000 + compte tiers au Débit, 512 au Crédit).
          Lorsque les fonds sont arrivés en banque (512 au Débit, 460 au Crédit), le cycle est
          soldé. L'analyseur reconnaît ces écritures comme normales, ainsi que l'annulation de
          paiement (512 au Débit, 401000 + compte tiers au Crédit).
        </p>
        <div className="num mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
          {CYCLE_CHAIN.map((etape, i) => (
            <span key={etape} className="flex items-center gap-2">
              {i > 0 && <ArrowRight className="size-3.5 text-muted-foreground" />}
              <span className="rounded bg-secondary px-2 py-1 font-semibold">{etape}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {SCHEMA_ECRITURES.map((etape) => (
          <EtapeCard key={etape.etape} etape={etape} />
        ))}
      </div>
      <div className="mt-4">
        <div className="panel p-5">
          <p className="text-sm font-semibold">Annulation de paiement (hors cycle)</p>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Les écritures 401000 + compte tiers au Crédit / 512xxx au Débit sont des annulations de
            paiement : la banque rend les fonds et le prestataire ou client est recrédité. Elles
            sont reconnues comme normales et ne sont jamais signalées comme anomalies.
          </p>
        </div>
        <div className="mt-4">
          <EtapeCard etape={SCHEMA_ANNULATION_PAIEMENT} />
        </div>
      </div>
      <BanquesSocietes />
    </section>
  );
}

/** Cartographie des journaux de trésorerie et des comptes 512/513 par société. */
function BanquesSocietes() {
  return (
    <div className="panel mt-4 overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <p className="text-sm font-semibold">Banques des sociétés — journaux de trésorerie</p>
        <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
          Chaque société encaisse et décaisse sur ses propres comptes 512/513 : le compte de banque
          des étapes 3 et 4 est donc celui de la société concernée. Les honoraires et revenus de MCI
          CARE (411 et 606200) encaissés sur la banque d'un client (ex. BOATSA 411140 Crédit /
          512140 Débit) doivent repartir vers une banque de MCI CARE via 580001 : BOATSA 580001
          Débit / 512140 Crédit puis BOAMCI 580001 Crédit / 512000 Débit (ou BNITEM 580001 Crédit /
          512005 Débit). BOAMCI 512000 (BOA MCI) est la banque principale de MCI CARE ; BNITEM
          512005 (BNI MCI TEMPORAIRE) sert aussi à MCI CARE, aux côtés du Mobile Money MVOMCI 513000
          (MVOLA) ; MVOTEL 513140 est la banque MVOLA de TELMA ; MVOHOL 513110 est la banque MVOLA
          de SANLAMALLIANZ COMPAGNIE sur fixe 103. L'analyse raisonne au niveau société : un
          compte-à-compte déjà passé depuis n'importe quelle banque de la société vers la même
          destination (ex. BNITEM 512005 → BNIAIT 512210) couvre les fonds arrivés sur une autre
          banque de la même société (ex. MVOMCI 513000 via le tier FONAITS 460210) — aucun doublon
          n'est demandé. Les honoraires et revenus ne partent pas un à un : plusieurs écritures
          411/606200 peuvent être regroupées en un seul compte-à-compte (ex. deux 411140 de 1 000 →
          un transfert de 2 000) ; seule la part non couverte est proposée, en une écriture.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2 font-semibold">Journal</th>
              <th className="px-4 py-2 font-semibold">Compte</th>
              <th className="px-4 py-2 font-semibold">Intitulé plan</th>
              <th className="px-4 py-2 font-semibold">Type</th>
              <th className="px-4 py-2 font-semibold">Société</th>
              <th className="px-4 py-2 font-semibold">Suffixe(s) client</th>
            </tr>
          </thead>
          <tbody>
            {BANQUES_SOCIETES.map((b) => (
              <tr key={b.compte} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2.5 font-semibold">{b.journal}</td>
                <td className="num px-4 py-2.5">{b.compte}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{b.intitule}</td>
                <td className="px-4 py-2.5">
                  <span className="rounded bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {b.operateur ? `${b.operateur} · Mobile Money` : b.type}
                  </span>
                </td>
                <td className="px-4 py-2.5">{b.societe}</td>
                <td className="num px-4 py-2.5 text-muted-foreground">
                  {b.suffixes.join(", ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {BANQUES_SOCIETES.some((b) => b.note) && (
        <div className="border-t border-border px-4 py-3">
          {BANQUES_SOCIETES.filter((b) => b.note).map((b) => (
            <p key={b.compte} className="text-xs text-muted-foreground">
              <span className="num font-semibold text-foreground">{b.compte}</span> — {b.note}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

const TYPE_TIERS_LABEL: Record<string, string> = {
  Four: "Fournisseur",
  Client: "Client",
  Autre: "Autre",
  Salar: "Salarié",
};

function Referentiel() {
  const [vue, setVue] = useState<"comptes" | "tiers">("comptes");
  const [q, setQ] = useState("");
  const [filtre, setFiltre] = useState("toutes");
  const [limit, setLimit] = useState(150);

  const norm = q.trim().toLowerCase();

  const familles = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of PLAN_COMPTABLE) {
      const f = familleCompte(c.numero);
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    return [...counts.entries()];
  }, []);

  const comptes = useMemo(
    () =>
      PLAN_COMPTABLE.filter(
        (c) =>
          (filtre === "toutes" || familleCompte(c.numero) === filtre) &&
          (!norm ||
            c.numero.includes(norm) ||
            c.intitule.toLowerCase().includes(norm) ||
            c.nature.toLowerCase().includes(norm)),
      ),
    [norm, filtre],
  );

  const tiers = useMemo(
    () =>
      PLAN_TIERS.filter(
        (t) =>
          (filtre === "toutes" || t.type === filtre) &&
          (!norm || t.code.toLowerCase().includes(norm) || t.intitule.toLowerCase().includes(norm)),
      ),
    [norm, filtre],
  );

  const rows = vue === "comptes" ? comptes : tiers;
  const sel =
    "rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent";
  const badge =
    "h-fit rounded bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground";

  return (
    <section className="mt-6">
      <div className="panel p-5">
        <p className="text-sm font-semibold">Plan comptable & plan tiers — Sage 100cloud</p>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Référentiel MCI CARE MADAGASCAR importé des états Sage : {NB_COMPTES_PLAN} comptes et{" "}
          {NB_TIERS_PLAN} tiers. Les libellés du plan s'affichent automatiquement sur les comptes du
          tableau de bord, des anomalies, des comptes à comptes et de l'export Excel.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["comptes", "tiers"] as const).map((v) => (
            <button
              key={v}
              onClick={() => {
                setVue(v);
                setFiltre("toutes");
                setLimit(150);
              }}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
                vue === v
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-card hover:border-accent"
              }`}
            >
              {v === "comptes"
                ? `Plan comptable (${NB_COMPTES_PLAN})`
                : `Plan tiers (${NB_TIERS_PLAN})`}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 mt-4 flex flex-wrap gap-3">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setLimit(150);
          }}
          placeholder={
            vue === "comptes"
              ? "Rechercher un n° de compte ou un intitulé…"
              : "Rechercher un code ou un intitulé de tiers…"
          }
          className="min-w-56 flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <select
          value={filtre}
          onChange={(e) => {
            setFiltre(e.target.value);
            setLimit(150);
          }}
          className={sel}
        >
          <option value="toutes">Toutes les familles</option>
          {vue === "comptes"
            ? familles.map(([f, n]) => (
                <option key={f} value={f}>
                  {f} ({n})
                </option>
              ))
            : Object.entries(TYPE_TIERS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v} ({PLAN_TIERS.filter((t) => t.type === k).length})
                </option>
              ))}
        </select>
      </div>

      <p className="mb-3 text-sm text-muted-foreground">
        {rows.length.toLocaleString("fr-FR")} {vue === "comptes" ? "compte(s)" : "tier(s)"}
        {rows.length > limit && ` — affichage limité à ${limit}`}
      </p>

      <div className="panel divide-y divide-border">
        {vue === "comptes"
          ? comptes.slice(0, limit).map((c) => (
              <div
                key={c.numero}
                className="grid gap-1 px-4 py-2 sm:grid-cols-[110px_1fr_auto] sm:items-center"
              >
                <span className="num text-sm font-semibold">{c.numero}</span>
                <span className="truncate text-sm">{c.intitule}</span>
                <span className={badge}>{c.nature || familleCompte(c.numero)}</span>
              </div>
            ))
          : tiers.slice(0, limit).map((t) => (
              <div
                key={`${t.type}-${t.code}`}
                className="grid gap-1 px-4 py-2 sm:grid-cols-[140px_110px_1fr] sm:items-center"
              >
                <span className="num text-sm font-semibold">{t.code}</span>
                <span className={`${badge} w-fit`}>{TYPE_TIERS_LABEL[t.type] ?? t.type}</span>
                <span className="truncate text-sm">{t.intitule}</span>
              </div>
            ))}
        {rows.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Aucun résultat pour cette recherche.
          </p>
        )}
      </div>

      {rows.length > limit && (
        <button
          onClick={() => setLimit((l) => l + 250)}
          className="mt-4 w-full rounded-md border border-border bg-card py-2.5 text-sm font-semibold hover:border-accent"
        >
          Afficher plus ({rows.length - limit} restantes)
        </button>
      )}
    </section>
  );
}

function EtapeCard({ etape }: { etape: EtapeSchema }) {
  const debit = etape.lignes.filter((l) => l.sens === "Débit");
  const credit = etape.lignes.filter((l) => l.sens === "Crédit");
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <p className="text-sm font-semibold">
          <span className="num mr-2 text-muted-foreground">
            {etape.role === "annulation_paiement" ? "Hors cycle" : `Étape ${etape.etape}`}
          </span>
          {etape.titre}
        </p>
        <span
          className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
            etape.journal === "TIERS"
              ? "bg-primary/10 text-primary"
              : "bg-secondary text-secondary-foreground"
          }`}
        >
          {etape.journal}
        </span>
      </div>
      <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Débit
          </p>
          {debit.map((l) => (
            <div key={l.sens + l.compte} className="mt-2">
              <p className="num text-sm font-bold">
                {l.compte}
                {l.complement && (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    {l.complement}
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">{l.note}</p>
            </div>
          ))}
        </div>
        <div className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Crédit
          </p>
          {credit.map((l) => (
            <div key={l.sens + l.compte} className="mt-2">
              <p className="num text-sm font-bold">
                {l.compte}
                {l.complement && (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    {l.complement}
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">{l.note}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const OP_LABEL = OPERATION_LABELS;
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
  const sel =
    "rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent";
  return (
    <section className="mt-6">
      <div className="mb-4 flex flex-wrap gap-3">
        <select
          value={statut}
          onChange={(e) => {
            setStatut(e.target.value as never);
            setLimit(100);
          }}
          className={sel}
        >
          <option value="tous">Tous les statuts</option>
          {Object.entries(ST_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value as never);
            setLimit(100);
          }}
          className={sel}
        >
          <option value="tous">Toutes les opérations</option>
          {Object.entries(OP_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        {list.length.toLocaleString("fr-FR")} écriture(s) de compte à compte via 580001 — les « Déjà
        passée » sont reconnues sans erreur (aucun doublon à créer), le compteur d'onglet ne compte
        que les « À créer ».
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
                    Envoyeur ({t.journalSource}) :{" "}
                    {t.envoyeur.map((l) => `${avecLibelle(l.compte)} ${l.sens}`).join(" / ")}
                  </div>
                  <div className="rounded bg-secondary/60 px-2 py-1">
                    Réceptionnaire ({t.journalDestination}) :{" "}
                    {t.receptionnaire.map((l) => `${avecLibelle(l.compte)} ${l.sens}`).join(" / ")}
                  </div>
                </div>
              )}
            </div>
            <div className="text-right">
              <p className="num text-sm font-semibold">{fmt(t.montant)}</p>
              <p
                className={`mt-1 text-[11px] font-semibold uppercase ${t.statut === "a_creer" ? "text-destructive" : t.statut === "manuel" ? "text-accent-foreground" : "text-success"}`}
              >
                {ST_LABEL[t.statut]}
              </p>
            </div>
          </div>
        ))}
        {list.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Aucune écriture pour ces filtres.
          </p>
        )}
      </div>
      {list.length > limit && (
        <button
          onClick={() => setLimit((l) => l + 200)}
          className="mt-4 w-full rounded-md border border-border bg-card py-2.5 text-sm font-semibold hover:border-accent"
        >
          Afficher plus ({list.length - limit} restantes)
        </button>
      )}
    </section>
  );
}
