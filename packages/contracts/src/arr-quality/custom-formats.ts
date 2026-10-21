/**
 * The custom format library the presets draw from.
 *
 * Curated by hand from the TRaSH guides, and deliberately smaller and simpler
 * than them. TRaSH's regexes are tuned against years of edge cases, and
 * transcribing them wholesale would mean shipping hundreds of lines nobody here
 * can review. These cover the decisions that actually move quality: reject the
 * junk, prefer the known-good groups, and break ties on source and HDR. Every
 * regex has match/miss examples, checked in `arr-quality.test.ts`.
 *
 * **Names match TRaSH's exactly, with no Rube prefix.** Someone who
 * already ran Recyclarr has a `BR-DISK` format, and the planner adopts it by
 * name rather than creating a second one that would double-score every
 * release.
 *
 * Field values are the *Arr's own enum integers. They differ per app, which
 * is why a format carries a spec list per service rather than one shared list.
 */

import type { ArrService } from "../arr.ts";

export interface CustomFormatSpecDef {
  name: string;
  implementation: string;
  negate?: boolean;
  required?: boolean;
  /** Field name → value. Merged onto the instance's own schema template. */
  fields: Record<string, string | number>;
}

export interface CustomFormatDef {
  name: string;
  /** Why it exists, shown in the preview. */
  note: string;
  specs: Partial<Record<ArrService, CustomFormatSpecDef[]>>;
  /** Release titles this must and must not match, checked by the contracts test. */
  examples?: { match: string[]; miss: string[] };
}

// ── Enum values ───────────────────────────────────────────────────────────

const RADARR_SOURCE = { bluray: 9, webdl: 7, webrip: 8 } as const;
const SONARR_SOURCE = { bluray: 6, webdl: 3, webrip: 4 } as const;
const RADARR_MODIFIER = { brdisk: 4, remux: 5 } as const;

// ── Spec builders ─────────────────────────────────────────────────────────

function title(name: string, value: string, opts: { negate?: boolean; required?: boolean } = {}): CustomFormatSpecDef {
  return { name, implementation: "ReleaseTitleSpecification", fields: { value }, ...opts };
}

function group(name: string, value: string): CustomFormatSpecDef {
  return { name, implementation: "ReleaseGroupSpecification", fields: { value } };
}

function source(name: string, value: number, opts: { negate?: boolean; required?: boolean } = {}): CustomFormatSpecDef {
  return { name, implementation: "SourceSpecification", fields: { value }, ...opts };
}

function resolution(
  name: string,
  value: number,
  opts: { negate?: boolean; required?: boolean } = {},
): CustomFormatSpecDef {
  return { name, implementation: "ResolutionSpecification", fields: { value }, ...opts };
}

function radarrModifier(name: string, value: number, opts: { negate?: boolean; required?: boolean } = {}) {
  return { name, implementation: "QualityModifierSpecification", fields: { value }, ...opts } as CustomFormatSpecDef;
}

/** The same title-only spec list on both apps. */
function both(specs: CustomFormatSpecDef[]): CustomFormatDef["specs"] {
  return { radarr: specs, sonarr: specs };
}

/** Group tiers: one of the groups, from a WEB source. */
function webTier(groups: string): CustomFormatDef["specs"] {
  return {
    radarr: [group("Groups", groups), source("WEBDL", RADARR_SOURCE.webdl), source("WEBRIP", RADARR_SOURCE.webrip)],
    sonarr: [group("Groups", groups), source("WEBDL", SONARR_SOURCE.webdl), source("WEBRIP", SONARR_SOURCE.webrip)],
  };
}

/** Group tiers: one of the groups, from a Bluray encode that is not a remux. */
function blurayTier(groups: string, res: 1080 | 2160): CustomFormatDef["specs"] {
  return {
    radarr: [
      group("Groups", groups),
      source("Bluray", RADARR_SOURCE.bluray, { required: true }),
      radarrModifier("Not Remux", RADARR_MODIFIER.remux, { negate: true, required: true }),
      resolution(`${res}p`, res, { required: true }),
    ],
  };
}

function remuxTier(groups: string): CustomFormatDef["specs"] {
  return {
    radarr: [group("Groups", groups), radarrModifier("Remux", RADARR_MODIFIER.remux, { required: true })],
  };
}

// ── The library ───────────────────────────────────────────────────────────

const HDR_ANY = String.raw`\b(HDR(10)?(\+|P(lus)?)?|PQ|HLG)\b`;
const DOLBY_VISION = String.raw`\b(DV|DoVi|Dolby[ ._-]?Vision)\b`;

export const CUSTOM_FORMATS = [
  // Unwanted. Scored −10000 everywhere, so with a minimum score of 0 they
  // are never grabbed.
  {
    name: "BR-DISK",
    note: "Untouched disc images. Plex cannot play them.",
    specs: {
      radarr: [radarrModifier("BR-DISK", RADARR_MODIFIER.brdisk)],
      sonarr: [
        title(
          "BR-DISK",
          String.raw`\b(BR[ ._-]?DISK|BDMV|COMPLETE[ ._-]?(UHD[ ._-]?)?BLU[ ._-]?RAY|(BD|UHD)[ ._-]?(25|50|66|100))\b`,
        ),
      ],
    },
    examples: {
      match: ["Show.S01.COMPLETE.BLURAY-GRP", "Show.S01.1080p.BD50-GRP"],
      miss: ["Show.S01E01.1080p.BluRay.x264-GRP"],
    },
  },
  {
    name: "LQ",
    note: "Groups known for bad encodes, re-encodes of re-encodes, or fakes.",
    specs: both([
      group(
        "LQ Groups",
        String.raw`^(aXXo|CDDHD|CrEwSaDe|E4G|FGT|FRDS|FZHD|GalaxyRG|GalaxyTV|iNTENSO|iPlanet|JFF|KiNGDOM|LAMA|mHD|mSD|NhaNc3|nHD|nikt0|nSD|Pahe|PSA|SANTi|ShAaNiG|STUTTERSHIT|TGx|WAF|x0r|YIFY|YTS|Zero00)$`,
      ),
    ]),
  },
  {
    name: "LQ (Release Title)",
    note: "Low-quality markers that live in the title rather than the group.",
    specs: both([title("LQ Title", String.raw`\b(TeeWee|1XBET|Ben[ ._-]The[ ._-]Men)\b`)]),
    examples: { match: ["Film.2020.1080p.WEB.1XBET"], miss: ["Film.2020.1080p.WEB-DL.DDP5.1-NTb"] },
  },
  {
    name: "3D",
    note: "3D releases play as two squashed images on a normal screen.",
    specs: both([title("3D", String.raw`\b(3D|SBS|Half[ ._-]?OU|Half[ ._-]?SBS)\b`)]),
    examples: {
      match: ["Film.2010.1080p.3D.HSBS.BluRay", "Film.2010.Half-SBS.1080p"],
      miss: ["Film.2010.1080p.BluRay"],
    },
  },
  {
    name: "Upscaled",
    note: "AI or regrade upscales sold as a higher resolution than the source.",
    specs: both([title("Upscaled", String.raw`\b(Up[ ._-]?scaled?|Re-?grade|AIUS)\b`)]),
    examples: { match: ["Film.1999.2160p.Upscaled.WEB", "Film.1999.2160p.Regrade"], miss: ["Film.1999.2160p.WEB-DL"] },
  },
  {
    name: "Extras",
    note: "Bonus material that would otherwise be grabbed as the feature.",
    specs: both([title("Extras", String.raw`\b(Extras|Bonus|Featurettes?|Behind[ ._-]the[ ._-]Scenes)\b`)]),
    examples: { match: ["Film.2001.Extras.1080p.BluRay"], miss: ["Film.2001.1080p.BluRay"] },
  },
  {
    name: "Obfuscated",
    note: "Renamed or reposted releases whose true origin is hidden.",
    specs: both([
      title(
        "Obfuscated",
        String.raw`-(4P|4Planet|AsRequested|AlternativeToRequested|BUYMORE|Chamele0n|GEROV|iNC0GNiTO|NZBGeek|Obfuscated|postbot|Rakuv|Scrambled|WhiteRev|WRTEAM|xpost)\b`,
      ),
    ]),
    examples: { match: ["Film.2020.1080p.WEB-DL-Obfuscated"], miss: ["Film.2020.1080p.WEB-DL-NTb"] },
  },
  {
    name: "Retags",
    note: "Someone else's release with a tracker's tag stuck on the end.",
    specs: both([title("Retags", String.raw`(\[(rartv|rarbg|eztv([ ._-]re)?|TGx)\]|-(EzzRips|RARTV)\b)`)]),
    examples: { match: ["Film.2020.1080p.WEB.H264-GRP[rarbg]"], miss: ["Film.2020.1080p.WEB.H264-GRP"] },
  },
  {
    name: "Bad Dual Groups",
    note: "Dual-audio groups that replace the original audio track.",
    specs: both([
      group(
        "Groups",
        String.raw`^(alfaHD|BAT|BlackBit|BNd|C\.A\.A|Cory|EXTREME|FF|FOXX|G4RiS|GUEIRA|LCD|N3G4N|PD|PTHome|RiPER|RK|SiGLA|Tars|tokar86a|vnlls|WTV|Yatogam1|YusukeFLA|ZigZag|ZNM)$`,
      ),
    ]),
  },
  {
    name: "AV1",
    note: "AV1 still direct-plays on too few Plex clients.",
    specs: both([title("AV1", String.raw`\bAV1\b`)]),
    examples: { match: ["Film.2023.2160p.WEB.AV1-GRP"], miss: ["Film.2023.2160p.WEB.H265-GRP"] },
  },
  {
    name: "x265 (HD)",
    note: "HEVC below 2160p. Usually a re-encode, so penalised by default and preferred by the compact presets.",
    specs: both([
      title("x265", String.raw`[xh][ ._-]?265|\bHEVC(\b|\d)`, { required: true }),
      resolution("Not 2160p", 2160, { negate: true, required: true }),
    ]),
  },
  {
    name: "DV (w/o HDR fallback)",
    note: "Dolby Vision without an HDR10 layer shows purple and green on non-DV displays.",
    specs: both([
      title("Dolby Vision", DOLBY_VISION, { required: true }),
      title("No HDR fallback", HDR_ANY, { negate: true, required: true }),
    ]),
    examples: { match: ["Film.2022.2160p.WEB-DL.DV.H265-GRP"], miss: ["Film.2022.2160p.WEB-DL.DV.HDR10.H265-GRP"] },
  },

  // Preferred groups. Tiers, scored a little apart so a better tier wins
  // the tie at the same quality.
  {
    name: "HD Bluray Tier 01",
    note: "The most consistent 1080p Bluray encoders.",
    specs: blurayTier(
      String.raw`^(BBQ|BMF|c0kE|Chotab|CRiSC|CtrlHD|D-Z0N3|Dariush|decibeL|DON|EbP|EDPH|Geek|LolHD|NCmt|PTer|TayTO|TDD|TnP|VietHD|ZQ)$`,
      1080,
    ),
  },
  {
    name: "HD Bluray Tier 02",
    note: "Reliable 1080p Bluray encoders.",
    specs: blurayTier(String.raw`^(ATELiER|EA|HiDt|HiSD|iFT|NTb|QOQ|SA89|sbR)$`, 1080),
  },
  {
    name: "HD Bluray Tier 03",
    note: "Good 1080p Bluray encoders, often smaller.",
    specs: blurayTier(String.raw`^(BHDStudio|hallowed|HONE|LoRD|playHD|SPHD|W4NK3R)$`, 1080),
  },
  {
    name: "UHD Bluray Tier 01",
    note: "The most consistent 2160p Bluray encoders.",
    specs: blurayTier(String.raw`^(CtrlHD|DON|MainFrame|W4NK3R)$`, 2160),
  },
  {
    name: "UHD Bluray Tier 02",
    note: "Reliable 2160p Bluray encoders.",
    specs: blurayTier(String.raw`^(BMF|HDS|SPHD|WiLDCAT)$`, 2160),
  },
  {
    name: "UHD Bluray Tier 03",
    note: "Good 2160p Bluray encoders.",
    specs: blurayTier(String.raw`^(LoRD|SA89|sbR)$`, 2160),
  },
  {
    name: "Remux Tier 01",
    note: "The most trusted remux groups.",
    specs: remuxTier(String.raw`^(3L|BiZKiT|BLURANiUM|BMF|CiNEPHiLES|FraMeSToR|PiRAMiDHEAD|PmP|WiLDCAT|ZQ)$`),
  },
  {
    name: "Remux Tier 02",
    note: "Reliable remux groups.",
    specs: remuxTier(String.raw`^(decibeL|EPSiLON|HiFi|KRaLiMaRKo|NCmt|playBD|PTer|SiCFoI|TRiToN)$`),
  },
  {
    name: "WEB Tier 01",
    note: "The most consistent WEB-DL groups.",
    specs: webTier(
      String.raw`^(ABBIE|AJP69|APEX|PAXA|PEXA|XEPA|BLUTONiUM|CMRG|CRFW|CRUD|FLUX|GNOME|KiNGS|Kitsune|NOSiViD|NTb|NTG|SiC|TEPES)$`,
    ),
  },
  {
    name: "WEB Tier 02",
    note: "Reliable WEB-DL groups.",
    specs: webTier(String.raw`^(3cTWeB|dB|MiU|monkee|MZABI|PHOENiX|playWEB|SMURF|TOMMY|XEBEC)$`),
  },
  {
    name: "WEB Tier 03",
    note: "Good WEB-DL groups.",
    specs: webTier(String.raw`^(BLOOM|Dooky|GNOMiSSiON|NINJACENTRAL|NPMS|ROCCaT|SiGMA|SLiGNOME|SwAgLaDy)$`),
  },

  // Tie-breakers.
  {
    name: "Repack/Proper",
    note: "A fixed re-release of something already out.",
    specs: both([title("Repack/Proper", String.raw`\b(Repack|Proper)\b`)]),
    examples: { match: ["Show.S01E01.REPACK.1080p.WEB"], miss: ["Show.S01E01.1080p.WEB"] },
  },
  {
    name: "Repack2",
    note: "A second fix, preferred over the first.",
    specs: both([title("Repack2", String.raw`\b(Repack2|Proper2)\b`)]),
    examples: { match: ["Show.S01E01.REPACK2.1080p.WEB"], miss: ["Show.S01E01.REPACK.1080p.WEB"] },
  },
  {
    name: "AMZN",
    note: "Amazon. Good bitrates, inconsistent HDR.",
    specs: both([title("Amazon", String.raw`\b(AMZN|Amazon(HD)?)\b`)]),
    examples: { match: ["Show.S01E01.1080p.AMZN.WEB-DL"], miss: ["Show.S01E01.1080p.NF.WEB-DL"] },
  },
  {
    name: "ATVP",
    note: "Apple TV+. Among the highest streaming bitrates.",
    specs: both([title("Apple TV+", String.raw`\b(ATVP|APTV|Apple[ ._-]?TV\+?)\b`)]),
    examples: { match: ["Show.S01E01.2160p.ATVP.WEB-DL"], miss: ["Show.S01E01.2160p.AMZN.WEB-DL"] },
  },
  {
    name: "DSNP",
    note: "Disney+.",
    specs: both([title("Disney+", String.raw`\b(DSNP|DSNY|Disney\+?)\b`)]),
    examples: { match: ["Show.S01E01.1080p.DSNP.WEB-DL"], miss: ["Show.S01E01.1080p.WEB-DL"] },
  },
  {
    name: "HMAX",
    note: "HBO Max.",
    specs: both([title("HBO Max", String.raw`\b(HMAX|HBOM|HBO[ ._-]?Max)\b`)]),
    examples: { match: ["Show.S01E01.1080p.HMAX.WEB-DL"], miss: ["Show.S01E01.1080p.HULU.WEB-DL"] },
  },
  {
    name: "NF",
    note: "Netflix.",
    specs: both([title("Netflix", String.raw`\b(NF|Netflix(U?HD)?)\b`)]),
    examples: { match: ["Show.S01E01.1080p.NF.WEB-DL"], miss: ["Show.S01E01.1080p.AMZN.WEB-DL"] },
  },
  {
    name: "PCOK",
    note: "Peacock.",
    specs: both([title("Peacock", String.raw`\b(PCOK|Peacock)\b`)]),
    examples: { match: ["Show.S01E01.1080p.PCOK.WEB-DL"], miss: ["Show.S01E01.1080p.NF.WEB-DL"] },
  },

  // HDR. Only used by the 2160p presets.
  {
    name: "DV HDR10",
    note: "Dolby Vision with an HDR10 fallback. Best of both.",
    specs: both([
      title("Dolby Vision", DOLBY_VISION, { required: true }),
      title("HDR10", String.raw`\bHDR(10)?\b`, { required: true }),
    ]),
    examples: { match: ["Film.2022.2160p.WEB-DL.DV.HDR10.H265"], miss: ["Film.2022.2160p.WEB-DL.HDR10.H265"] },
  },
  {
    name: "HDR10+",
    note: "Dynamic HDR metadata, preferred over static HDR10.",
    specs: both([title("HDR10+", String.raw`\bHDR10(\+|P(lus)?\b)`)]),
    examples: {
      match: ["Film.2022.2160p.WEB-DL.HDR10+.H265", "Film.2022.2160p.HDR10Plus"],
      miss: ["Film.2022.2160p.HDR10.H265"],
    },
  },
  {
    name: "HDR",
    note: "Any HDR at all, over SDR.",
    specs: both([title("HDR", HDR_ANY)]),
    examples: { match: ["Film.2022.2160p.WEB-DL.HDR.H265"], miss: ["Film.2022.2160p.WEB-DL.SDR.H265"] },
  },

  // Audio. Small scores: a tie-breaker between two otherwise equal releases,
  // never a reason to take a worse encode.
  {
    name: "TrueHD ATMOS",
    note: "Lossless audio with Atmos.",
    specs: both([
      title("TrueHD", String.raw`\bTrue[ ._-]?HD\b`, { required: true }),
      title("Atmos", String.raw`\bATMOS(\b|\d)`, { required: true }),
    ]),
    examples: { match: ["Film.2019.2160p.Remux.TrueHD.Atmos.7.1"], miss: ["Film.2019.2160p.Remux.TrueHD.7.1"] },
  },
  {
    name: "DTS-HD MA",
    note: "Lossless DTS.",
    specs: both([title("DTS-HD MA", String.raw`\bDTS[ ._-]?(HD[ ._-]?)?MA\b`)]),
    examples: { match: ["Film.2019.1080p.Remux.DTS-HD.MA.5.1"], miss: ["Film.2019.1080p.BluRay.DTS.5.1"] },
  },
  {
    name: "DD+ ATMOS",
    note: "Streaming Atmos.",
    specs: both([
      title("DD+", String.raw`\b(DDP|DD\+|E-?AC-?3)`, { required: true }),
      title("Atmos", String.raw`\bATMOS(\b|\d)`, { required: true }),
    ]),
    examples: { match: ["Film.2023.2160p.WEB-DL.DDP5.1.Atmos.H265"], miss: ["Film.2023.2160p.WEB-DL.DDP5.1.H265"] },
  },
] as const satisfies readonly CustomFormatDef[];

export type CustomFormatName = (typeof CUSTOM_FORMATS)[number]["name"];

const BY_NAME = new Map<string, CustomFormatDef>(CUSTOM_FORMATS.map((f) => [f.name, f]));

export function customFormatDef(name: string): CustomFormatDef | undefined {
  return BY_NAME.get(name);
}
