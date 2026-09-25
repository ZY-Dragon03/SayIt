import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  normalizeLexicalSurface as normalize,
  resolveLemma,
} from "../src/lib/lemma-core.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FREQUENCY_SOURCE = path.join(
  REPO_ROOT,
  "scripts/lexicon/frequency-en-wordfreq-3.0.2-top-12000.txt",
);
const SENSE_COUNT_SOURCE = path.join(
  REPO_ROOT,
  "scripts/lexicon/wordnet-primary-sense-counts.tsv",
);
const WORDNET_ROOT = path.join(REPO_ROOT, "node_modules/wordnet");
const OUTPUT_PATH = path.join(REPO_ROOT, "public/data/sayit-lexicon.v1.json");
const MANIFEST_PATH = path.join(
  REPO_ROOT,
  "public/data/sayit-lexicon.manifest.json",
);
const FREQUENCY_LIST_SHA256 =
  "56abcb2db68a0c0dd774a3ca14c53a049dbb6d5109e8dc49113b1a980af47b27";
const FREQUENCY_WHEEL_SHA256 =
  "c5bfdf26cc26437d670ef145326e4e395cf0a4f4de2da85a331ddf3d2a334588";
const SENSE_COUNT_SOURCE_SHA256 =
  "d520a2366e417c7ddfc3f3c36447322d3713f35a2ec701524e4a7b292ecd2c33";
const WORDNET_DATABASE_ARCHIVE_SHA256 =
  "658b1ba191f5f98c2e9bae3e25c186013158f30ef779f191d2a44e5d25046dc8";
const WORDNET_SENSE_INDEX_SHA256 =
  "68b3a468cddfd8e92134b9b0624339a02a1b837159243c297c5f138a3d618392";
const WORDNET_TARBALL_INTEGRITY =
  "sha512-VQOEUBHU6drwXGQx37bVaRqi042IZ8NwJiT9qLtM2x1QzqgIJIRoyZa++rWrUvICK+tYz9ttfYFk1c8IiN6DVQ==";
const GOLDEN = [
  "gag",
  "cartoon",
  "categorize",
  "granted",
  "reference",
  "literal",
  "xyznotaword",
];
const MORPHOLOGY_GOLDEN = [
  ["granted", "grant"],
  ["uses", "use"],
  ["referencing", "reference"],
  ["kicked", "kick"],
  ["children", "child"],
];
const MORPHOLOGY_SURFACES = new Set(
  MORPHOLOGY_GOLDEN.map(([surface]) => surface),
);
const POS_ORDER = ["n", "v", "a", "s", "r"];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseDataFile(text) {
  const glosses = new Map();
  for (const line of text.split(/\r?\n/)) {
    const separator = line.indexOf("|");
    if (separator < 0) continue;
    const offset = line.slice(0, separator).trim().split(/\s+/, 1)[0];
    if (!/^\d{8}$/.test(offset)) continue;
    const gloss = line.slice(separator + 1).trim();
    if (gloss) glosses.set(offset, gloss);
  }
  return glosses;
}

function parseIndexFile(text, target) {
  for (const line of text.split(/\r?\n/)) {
    if (!line || /^\s/.test(line)) continue;
    const parts = line.split(/\s+/);
    const lemma = parts[0].replaceAll("_", " ");
    const pos = parts[1];
    const pointerCount = Number(parts[3]);
    if (!lemma || !POS_ORDER.includes(pos) || !Number.isInteger(pointerCount)) {
      continue;
    }
    const firstOffset = parts[6 + pointerCount];
    if (!/^\d{8}$/.test(firstOffset ?? "")) continue;
    const senses = target.get(lemma) ?? new Map();
    senses.set(pos, firstOffset);
    target.set(lemma, senses);
  }
}

function parseSenseCountFile(text) {
  const counts = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const [lemma, pos, offset, rawTagCount] = line.split("\t");
    const tagCount = Number(rawTagCount);
    if (
      !lemma ||
      !POS_ORDER.includes(pos) ||
      !/^\d{8}$/.test(offset ?? "") ||
      !Number.isInteger(tagCount) ||
      tagCount < 0
    ) {
      throw new Error(`Invalid WordNet primary sense count row: ${line}`);
    }
    const indexPos = pos === "s" ? "a" : pos;
    const senses = counts.get(lemma) ?? new Map();
    const current = senses.get(indexPos);
    if (!current || current.tagCount < tagCount) {
      senses.set(indexPos, { offset, tagCount });
    }
    counts.set(lemma, senses);
  }
  return counts;
}

function resolveGitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function getArg(name) {
  return process.argv.includes(name);
}

async function main() {
  const frequencyBytes = await readFile(FREQUENCY_SOURCE);
  const actualFrequencyHash = sha256(frequencyBytes);
  if (actualFrequencyHash !== FREQUENCY_LIST_SHA256) {
    throw new Error(
      `Frequency source checksum mismatch: expected ${FREQUENCY_LIST_SHA256}, got ${actualFrequencyHash}`,
    );
  }
  const senseCountBytes = await readFile(SENSE_COUNT_SOURCE);
  const actualSenseCountHash = sha256(senseCountBytes);
  if (actualSenseCountHash !== SENSE_COUNT_SOURCE_SHA256) {
    throw new Error(
      `WordNet sense-count checksum mismatch: expected ${SENSE_COUNT_SOURCE_SHA256}, got ${actualSenseCountHash}`,
    );
  }

  const wordnetPackage = JSON.parse(
    await readFile(path.join(WORDNET_ROOT, "package.json"), "utf8"),
  );
  if (wordnetPackage.version !== "2.0.0") {
    throw new Error(
      `Expected wordnet@2.0.0, found wordnet@${wordnetPackage.version}`,
    );
  }

  const [nounData, verbData, adjData, advData, nounIndex, verbIndex, adjIndex, advIndex] =
    await Promise.all(
      [
        "data.noun",
        "data.verb",
        "data.adj",
        "data.adv",
        "index.noun",
        "index.verb",
        "index.adj",
        "index.adv",
      ].map((filename) =>
        readFile(path.join(WORDNET_ROOT, "db", filename), "utf8"),
      ),
    );

  if (
    ![nounData, verbData, adjData, advData].every((text) =>
      text.includes("WordNet 3.0 Copyright 2006 by Princeton University"),
    )
  ) {
    throw new Error("The installed WordNet data files are not WordNet 3.0.");
  }

  const glossesByPos = new Map([
    ["n", parseDataFile(nounData)],
    ["v", parseDataFile(verbData)],
    ["a", parseDataFile(adjData)],
    ["s", parseDataFile(adjData)],
    ["r", parseDataFile(advData)],
  ]);
  const indexes = new Map();
  parseIndexFile(nounIndex, indexes);
  parseIndexFile(verbIndex, indexes);
  parseIndexFile(adjIndex, indexes);
  parseIndexFile(advIndex, indexes);
  const senseCounts = parseSenseCountFile(senseCountBytes.toString("utf8"));

  const frequencyWords = frequencyBytes
    .toString("utf8")
    .split(/\r?\n/)
    .map(normalize)
    .filter((word) => /^[a-z]+$/.test(word));
  const lemmas = [
    ...new Set([
      ...frequencyWords,
      ...GOLDEN.filter((word) => word !== "xyznotaword").map(normalize),
      ...MORPHOLOGY_GOLDEN.map(([, lemma]) => lemma),
    ]),
  ];
  const entries = Object.create(null);
  for (const lemma of lemmas) {
    if (MORPHOLOGY_SURFACES.has(lemma)) continue;
    const senses = indexes.get(lemma);
    if (!senses) continue;
    const available = POS_ORDER.filter((pos) => senses.has(pos)).map((pos) => ({
      pos,
      offset: senseCounts.get(lemma)?.get(pos)?.offset ?? senses.get(pos),
      tagCount: senseCounts.get(lemma)?.get(pos)?.tagCount ?? 0,
    }));
    const tagged = available.filter((sense) => sense.tagCount > 0);
    const selected = tagged.sort(
      (left, right) => right.tagCount - left.tagCount,
    )[0] ?? available[0];
    const { pos, offset } = selected ?? {};
    const primary = pos && offset ? glossesByPos.get(pos)?.get(offset) : undefined;
    if (primary) entries[lemma] = { primary };
  }

  const goldenResults = GOLDEN.map((surface) => {
    const lemma = resolveLemma(surface, (candidate) =>
      Object.hasOwn(entries, candidate),
    );
    return {
      surface,
      lemma,
      hasDefinition: lemma !== null,
      expectedDefinition: surface !== "xyznotaword",
      passed: surface === "xyznotaword" ? lemma === null : lemma !== null,
    };
  });
  const morphologyResults = MORPHOLOGY_GOLDEN.map(
    ([surface, expectedLemma]) => {
      const resolvedLemma = resolveLemma(surface, (candidate) =>
        Object.hasOwn(entries, candidate),
      );
      return {
        surface,
        expectedLemma,
        resolvedLemma,
        passed: resolvedLemma === expectedLemma,
      };
    },
  );
  const goldenPassed = goldenResults.every((row) => row.passed);
  const morphologyPassed = morphologyResults.every((row) => row.passed);
  const artifactText = `${JSON.stringify({ version: 1, entries })}\n`;
  const artifactBytes = Buffer.from(artifactText, "utf8");
  const compressedBytes = gzipSync(artifactBytes, { level: 9, mtime: 0 });
  const spotCheck = Object.keys(entries)
    .map((lemma) => ({
      lemma,
      sampleKey: sha256(`sayit-lexicon-v1:${lemma}`),
      primary: entries[lemma].primary,
    }))
    .sort((left, right) => left.sampleKey.localeCompare(right.sampleKey))
    .slice(0, 100);
  const sizePassed = compressedBytes.byteLength <= 3 * 1024 * 1024;
  const entryCountPassed = Object.keys(entries).length >= 8000;
  const gatePassed =
    sizePassed && entryCountPassed && goldenPassed && morphologyPassed;
  const approved = getArg("--approve-compact");
  const spotCheckReviewed = getArg("--spot-check-reviewed");
  if (approved && (!gatePassed || !spotCheckReviewed)) {
    throw new Error(
      "Compact approval requires passing size/coverage and --spot-check-reviewed after the deterministic 100-entry manual review.",
    );
  }

  const now = new Date().toISOString();
  const manifest = {
    schemaVersion: 1,
    dictionaryDecision: approved ? "compact-approved" : "candidate-pending-review",
    generatedAt: now,
    gitSha: resolveGitSha(),
    wordnet: {
      package: "wordnet@2.0.0",
      packageUrl: "https://registry.npmjs.org/wordnet/-/wordnet-2.0.0.tgz",
      packageIntegrity: WORDNET_TARBALL_INTEGRITY,
      dataVersion: "WordNet 3.0",
      license: "Princeton University WordNet License",
      licenseFile: "WORDNET-LICENSE.txt",
      sourceOrder: POS_ORDER,
      senseSelection:
        "Among each POS first senses, choose the greatest WordNet 3.0 tag_count; ties or all-zero counts use noun, verb, adjective, satellite, adverb order.",
      senseCountSource: {
        name: "WordNet 3.0 index.sense first-sense tag_count values",
        archiveUrl: "https://wordnetcode.princeton.edu/3.0/WNdb-3.0.tar.gz",
        archiveSha256: WORDNET_DATABASE_ARCHIVE_SHA256,
        upstreamFile: "dict/index.sense",
        upstreamFileSha256: WORDNET_SENSE_INDEX_SHA256,
        filteredInputFile:
          "scripts/lexicon/wordnet-primary-sense-counts.tsv",
        filteredInputSha256: actualSenseCountHash,
        filteredRecordCount: [...senseCounts.values()].reduce(
          (count, senses) => count + senses.size,
          0,
        ),
      },
    },
    frequencySource: {
      name: "wordfreq 3.0.2 top_n_list('en', 12000, wordlist='large', ascii_only=True)",
      url: "https://pypi.org/project/wordfreq/3.0.2/",
      wheelUrl:
        "https://files.pythonhosted.org/packages/d4/9f/407e0b54b530028b960937f528ed34498d195523b4cad8c67e6bdc56e67f/wordfreq-3.0.2-py3-none-any.whl",
      wheelSha256: FREQUENCY_WHEEL_SHA256,
      selectedListFile:
        "../../scripts/lexicon/frequency-en-wordfreq-3.0.2-top-12000.txt",
      selectedListSha256: actualFrequencyHash,
      selectedWordCount: frequencyWords.length,
      license: "CC BY-SA 4.0 frequency data; wordfreq code is Apache-2.0",
      attribution:
        "Robyn Speer, wordfreq v3.0.2; source data includes Google Books Ngrams and Syntactic Ngrams, Leeds Internet Corpus, Wikipedia, ParaCrawl, OpenSubtitles 2018, SUBTLEX lists, and Twitter-derived frequency statistics. See scripts/lexicon/README.md.",
    },
    selection: {
      topN: 12000,
      policy:
        "frequency rank order, unique normalized alphabetic entries; union with positive SayIt golden lemmas",
      goldenLemmas: GOLDEN.filter((word) => word !== "xyznotaword").map(
        normalize,
      ),
    },
    entryCount: Object.keys(entries).length,
    artifactBytes: artifactBytes.byteLength,
    gzipBytes: compressedBytes.byteLength,
    sha256: sha256(artifactBytes),
    gzipSha256: sha256(compressedBytes),
    goldenCoverage: {
      passed: goldenResults.filter((row) => row.passed).length,
      total: goldenResults.length,
      positivePassed: goldenResults.filter(
        (row) => row.expectedDefinition && row.passed,
      ).length,
      positiveTotal: goldenResults.filter((row) => row.expectedDefinition)
        .length,
      negativeMissPassed:
        goldenResults.find((row) => row.surface === "xyznotaword")?.passed ??
        false,
      results: goldenResults,
    },
    morphologyFallbackCoverage: {
      passed: morphologyResults.filter((row) => row.passed).length,
      total: morphologyResults.length,
      results: morphologyResults,
    },
    approvalGate: {
      maxGzipBytes: 3 * 1024 * 1024,
      minEntryCount: 8000,
      sizePassed,
      entryCountPassed,
      goldenCoveragePassed: goldenPassed,
      morphologyCoveragePassed: morphologyPassed,
      randomSpotCheck: {
        method:
          "Sort entries by SHA-256('sayit-lexicon-v1:' + lemma), inspect first 100 primary glosses.",
        sampleSize: spotCheck.length,
        reviewed: spotCheckReviewed,
        reviewedAt: spotCheckReviewed ? now : null,
        sample: spotCheck.map(({ lemma, primary }) => ({ lemma, primary })),
      },
      passed: gatePassed && spotCheckReviewed,
    },
  };

  await writeFile(OUTPUT_PATH, artifactBytes);
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify(
      {
        dictionaryDecision: manifest.dictionaryDecision,
        entryCount: manifest.entryCount,
        artifactBytes: manifest.artifactBytes,
        gzipBytes: manifest.gzipBytes,
        sha256: manifest.sha256,
        gzipSha256: manifest.gzipSha256,
        goldenCoverage: `${manifest.goldenCoverage.passed}/${manifest.goldenCoverage.total}`,
        morphologyFallbackCoverage: `${manifest.morphologyFallbackCoverage.passed}/${manifest.morphologyFallbackCoverage.total}`,
        approvalGatePassed: manifest.approvalGate.passed,
      },
      null,
      2,
    )}\n`,
  );
}

await main();
