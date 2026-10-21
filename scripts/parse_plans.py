#!/usr/bin/env python3
"""Parse les PDF Sage (plan comptable + plan tiers, MCI CARE MADAGASCAR)
préalablement convertis en texte avec `pdftotext -layout` et génère les
fichiers TypeScript de données pour l'app smart-verif.

Sortie :
  src/lib/plan-comptable-data.ts   — PLAN_COMPTABLE
  src/lib/plan-tiers-data.ts       — PLAN_TIERS
"""

import json
import re
import sys
from pathlib import Path

UPLOAD = Path("/home/z/my-project/upload")
APP = Path("/home/z/my-project/smart-verif")

NATURES = [
    "Amortis./Provision",
    "Résultat-Bilan",
    "Immobilisation",
    "Capitaux",
    "Fournisseur",
    "Salarié",
    "Aucune",
    "Banque",
    "Caisse",
    "Titre",
    "Client",
    "Charge",
    "Produit",
]

TIERS_TYPES = ("Four", "Client", "Autre", "Salar")


def parse_comptes(txt: str):
    rows = []
    ignored = []
    for raw in txt.splitlines():
        line = raw.rstrip()
        m = re.match(r"^Détail\s+(\d{6})\s+(.*)$", line)
        if not m:
            if line.strip() and not re.match(
                r"^\s*$|MCI CARE|© Sage|Liste des comptes|^Type\s", line
            ):
                ignored.append(line)
            continue
        numero, rest = m.group(1), m.group(2).strip()
        nature = ""
        for n in NATURES:
            if rest.endswith(n):
                nature = n
                rest = rest[: -len(n)].rstrip()
                break
        rows.append({"numero": numero, "intitule": rest.strip(), "nature": nature})
    return rows, ignored


def parse_tiers(txt: str):
    rows = []
    ignored = []
    current = None
    for raw in txt.splitlines():
        line = raw.rstrip()
        if not line.strip():
            continue
        if (
            "Liste des tiers" in line
            or "MCI CARE" in line
            or line.lstrip().startswith("© Sage")
            or re.match(r"^\s*Type\s+Compte tiers", line)
        ):
            continue
        m = re.match(r"^(Four|Client|Autre|Salar)\s+(\S+)\s+(.*)$", line)
        if m:
            current = {"type": m.group(1), "code": m.group(2), "intitule": m.group(3).strip()}
            rows.append(current)
            continue
        # continuation d'intitulé (ligne indentée)
        stripped = line.strip()
        if current is not None and re.match(r"^\s{10,}\S", line):
            current["intitule"] = (current["intitule"] + " " + stripped).strip()
        else:
            ignored.append(line)
    return rows, ignored


def ts_comptes(rows):
    out = []
    out.append("// Généré automatiquement depuis Plan_comptable.pdf")
    out.append("// (Sage 100cloud Comptabilité — MCI CARE MADAGASCAR, tirage 21/10/26).")
    out.append("// Ne pas modifier à la main : relancer scripts/parse_plans.py.")
    out.append("")
    out.append("export interface ComptePlan {")
    out.append("  numero: string;")
    out.append("  intitule: string;")
    out.append("  nature: string;")
    out.append("}")
    out.append("")
    out.append("export const PLAN_COMPTABLE: ComptePlan[] = [")
    for r in rows:
        out.append(
            "  { numero: %s, intitule: %s, nature: %s },"
            % (json.dumps(r["numero"], ensure_ascii=False),
               json.dumps(r["intitule"], ensure_ascii=False),
               json.dumps(r["nature"], ensure_ascii=False))
        )
    out.append("];")
    out.append("")
    return "\n".join(out)


def ts_tiers(rows):
    out = []
    out.append("// Généré automatiquement depuis Plan_tiers.pdf")
    out.append("// (Sage 100cloud Comptabilité — MCI CARE MADAGASCAR, tirage 21/10/26).")
    out.append("// Ne pas modifier à la main : relancer scripts/parse_plans.py.")
    out.append("")
    out.append("export interface TiersPlan {")
    out.append("  code: string;")
    out.append('  /** Four | Client | Autre | Salar */')
    out.append("  type: string;")
    out.append("  intitule: string;")
    out.append("}")
    out.append("")
    out.append("export const PLAN_TIERS: TiersPlan[] = [")
    for r in rows:
        out.append(
            "  { code: %s, type: %s, intitule: %s },"
            % (json.dumps(r["code"], ensure_ascii=False),
               json.dumps(r["type"], ensure_ascii=False),
               json.dumps(r["intitule"], ensure_ascii=False))
        )
    out.append("];")
    out.append("")
    return "\n".join(out)


def main():
    comptes, ign_c = parse_comptes((UPLOAD / "plan_comptable.txt").read_text("utf-8"))
    tiers, ign_t = parse_tiers((UPLOAD / "plan_tiers.txt").read_text("utf-8"))

    (APP / "src/lib/plan-comptable-data.ts").write_text(ts_comptes(comptes), "utf-8")
    (APP / "src/lib/plan-tiers-data.ts").write_text(ts_tiers(tiers), "utf-8")

    print(f"Comptes : {len(comptes)}")
    print(f"Tiers   : {len(tiers)}")
    nat = {}
    for c in comptes:
        nat[c["nature"]] = nat.get(c["nature"], 0) + 1
    print("Natures :", nat)
    typ = {}
    for t in tiers:
        typ[t["type"]] = typ.get(t["type"], 0) + 1
    print("Types tiers :", typ)
    no_nat = [c for c in comptes if not c["nature"]]
    no_int_c = [c for c in comptes if not c["intitule"]]
    no_int_t = [t for t in tiers if not t["intitule"]]
    print(f"Comptes sans nature : {len(no_nat)}", [c["numero"] for c in no_nat][:10])
    print(f"Comptes sans intitulé : {len(no_int_c)}")
    print(f"Tiers sans intitulé : {len(no_int_t)}")
    print(f"Lignes comptes ignorées : {len(ign_c)}")
    for l in ign_c[:12]:
        print("   C|", l)
    print(f"Lignes tiers ignorées : {len(ign_t)}")
    for l in ign_t[:12]:
        print("   T|", l)


if __name__ == "__main__":
    sys.exit(main())
