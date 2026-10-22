/**
 * Comptes 512 partagés : entité sans compte 512 propre -> suffixe du compte
 * 512 utilisé. Seuls les comptes 467/460/461/462 sont à solder avec le 512 ;
 * chaque entité a ses propres comptes 46x mais peut partager le 512 d'une
 * autre entité (ex. AXIANSS, GES, WELIGHT, MADAGASCO, ATSS, VIA ASSURANCE
 * sont tous soldés avec 512220).
 */
export const SHARED_BANK = new Map<string, string>([
  ["PAMF", "190"], // EASY TECH
  ["EVIOSYS", "600"], // ex-SONOCO, compte 512600 (BOA EVIOSYS, alimenté par le journal Orange Money)
  ["INGEDATA", "600"],
  ["CAMUSAT", "600"],
  ["STELLARIX", "210"], // AITS
  ["GES", "220"], // AXIANSS
  ["WELIGHT", "220"],
  ["MADAGASCO", "220"],
  ["ATSS", "220"],
  ["VIA ASSURANCE", "220"],
  ["AXIAN UNIVERSITY", "240"], // TOM
  ["FONDATION AXIAN", "240"],
  ["SANKO", "260"], // FIRST IMMO
  ["FOUNDEVER", "700"], // SMARTONE
  ["KIDS AKADEMY", "800"], // NACRE
  ["NACRE DIR", "800"],
  ["RAHARIVOLA BRUNO", "800"], // payé par BNINAC (512800)
  ["TANJAKA FOOD", "350"], // OMNIVEST
  ["SANLAMALLIANZ AUTOFI", "501"], // compte propre 512501 (BNIALL) depuis 2026
  ["SANLAMALLIANZ COMPAGNIE", "100"], // 512100 SANLAM + 513110 M-Vola
  ["JBU", "320"], // compte 512320 de BOOST (BNIJB)
  ["JBS", "320"],
  ["BOOST", "320"],
  ["TAMBOHO", "201"], // compte 512201 de TALYS (BOAGTA)
  ["TAMBOHO HOSP", "201"],
  ["STMB", "201"],
  ["STMB HOSP", "201"],
  ["SANIFER = TALYS HOSP", "201"],
  ["SANIFER = TALYS COVID", "201"],
  ["SOCOTA/LECO", "330"], // compte 512330 de LECOFRUIT (BNILEC)
  ["EVASAN", "140"], // compte 512140 (BOATSA)
  ["DHL EXPRESS", "120"], // compte 512120
  ["MGS", "124"], // compte 512124 (BNI MGS/FSS)
]);

/**
 * Propriétaire explicite d'un compte de trésorerie listé par plusieurs blocs
 * de la feuille de vérification. 512600 (BOA EVIOSYS) figure à la fois dans le
 * bloc ORANGE MONEY MADAGASCAR (suffixe 600) et dans le bloc EVIOSYS de la
 * feuille « 2026 » du Verif BG ; la formule de contrôle du comptable
 * (G542 = E544+E553+E560, G543 = E546) le rattache à la famille EVIOSYS
 * (EVIOSYS + INGEDATA + CAMUSAT), ce que confirment les écritures du
 * brouillard : 512600 paie les factures CAMUSAT/SONOCO (46x603).
 */
export const BANQUE_PROPRIETAIRE = new Map<string, string>([["512600", "EVIOSYS"]]);
