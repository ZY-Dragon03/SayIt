# Third-party notices

SayIt's own source code is released under the [MIT License](LICENSE). SayIt uses
third-party software and data that stay under their own licenses. Those licenses are
recorded here; they are **not** relicensed as MIT.

## Bundled data

SayIt ships two generated data files under `public/data/`. Both are produced by
`npm run lexicon:generate` from the pinned sources recorded in
`public/data/sayit-lexicon.manifest.json`.

| Artifact | Content | License |
| --- | --- | --- |
| `sayit-lexicon.v1.json` — definitions, and 100 glosses inside the manifest | First WordNet 3.0 sense per word, from Princeton WordNet | Princeton WordNet License — verbatim text in [`public/data/WORDNET-LICENSE.txt`](public/data/WORDNET-LICENSE.txt) |
| `sayit-lexicon.v1.json` — word list | Frequency ranking from `wordfreq` 3.0.2, `top_n_list("en", 12000, wordlist="large", ascii_only=True)` | Frequency data CC BY-SA 4.0; the `wordfreq` code is Apache-2.0 |

### Princeton WordNet

WordNet 3.0 is Copyright 2006 by Princeton University. The Princeton license
requires its copyright notice and disclaimer to accompany all copies of the
database, and forbids using the name Princeton University in advertising or
publicity for the distribution. `public/data/WORDNET-LICENSE.txt` is the verbatim
notice; it sits under `public/`, so it is copied into the build output and served at
`/data/WORDNET-LICENSE.txt` alongside the lexicon.

Note on the build-time generator: the `wordnet` npm package (a devDependency used
only by `npm run lexicon:generate`) declares `license: MIT` in its own metadata while
shipping the WordNet 3.0 database files. That package's metadata cannot override
Princeton's notice requirement. SayIt records the real license in the manifest and
ships the Princeton text, which is what the generated artifact actually needs.

`scripts/lexicon/wordnet-primary-sense-counts.tsv` is a filtered extract of
`dict/index.sense` from the official WordNet 3.0 archive and carries the same
Princeton license. It is checksum-locked by the generator, so it must not be edited;
its provenance is recorded in the manifest.

### wordfreq

The frequency ranking is derived from `wordfreq` 3.0.2, whose frequency data is
**CC BY-SA 4.0** — a share-alike license. This means:

- the derived word list (`scripts/lexicon/frequency-en-wordfreq-3.0.2-top-12000.txt`
  and the word-list portion of `public/data/sayit-lexicon.v1.json`) is distributed
  under CC BY-SA 4.0, and **a redistributor must keep it under CC BY-SA 4.0 and keep
  this attribution**;
- the WordNet definitions in the same generated file are under the Princeton WordNet
  License, not CC BY-SA;
- the generator code, the ordering, and the sense-selection heuristic are SayIt's own
  MIT-licensed work.

Required credit, per `wordfreq`'s own notice: **Copyright 2022 Robyn Speer**, and
`wordfreq` must not be credited to a different name. `wordfreq`'s own notice also
sets these conditions, which SayIt repeats here: the SUBTLEX authors must be
credited, it must remain clear that SUBTLEX is freely available data, and the Google
Books Ngram Viewer is acknowledged as a data source. Other inputs include the Leeds
Internet Corpus, Wikipedia, ParaCrawl, OpenSubtitles 2018, and Twitter-derived
frequency statistics. Source URLs and checksums are in
`public/data/sayit-lexicon.manifest.json`; see also
[`scripts/lexicon/README.md`](scripts/lexicon/README.md).

Neither checked-in data file carries an in-file header, because the generator
verifies their SHA-256 and any edit would break `npm run lexicon:generate`. This
document and the manifest are their provenance record; keep them together with the
files.

## Pronunciation engine

SayIt does not write its own pronunciation engine.

The local IPA transcription is produced by **[`phonemize`](https://www.npmjs.com/package/phonemize) 2.0.1**,
MIT, Copyright (c) 2025 Hans. Its only transitive dependencies are
[`number-to-words`](https://www.npmjs.com/package/number-to-words) 1.2.5 (MIT) and
[`pinyin-pro`](https://www.npmjs.com/package/pinyin-pro) 3.29.5 (MIT).

`phonemize` ships compiled English rule tables and exception/letter-mapping data
inside its own package — notably a large English exception lexicon and an
ASCII-transliteration table. SayIt does not author, modify, or redistribute that
data: it is installed from npm by whoever runs `npm install`, and it stays under
whatever license its upstream authors hold. SayIt makes no license claim over it. If
you redistribute a built bundle that contains it, check
`node_modules/phonemize` for the current upstream notices.

### The former engine, and why it was replaced

Earlier versions of SayIt used the `phonemizer` npm package. That package declares
Apache-2.0 metadata, but its build is an Emscripten compilation of **eSpeak NG**,
which is **GPL-3.0-or-later**. Apache-2.0 metadata on the wrapper does not settle the
obligation on the bundled GPL code, and a GPL-derived engine cannot be shipped inside
an MIT project. It was therefore removed and replaced with the MIT `phonemize`
engine.

The bake-off between the two candidates, including the measured quality differences
that this replacement accepts, is recorded in
[`openspec/changes/replace-llm-ipa-with-local-lookup/design.md`](openspec/changes/replace-llm-ipa-with-local-lookup/design.md).
That document selected `phonemizer` for private local use and named "replacement with
a permissively licensed engine" as the condition for public distribution. This
release is that replacement; the engine it selected is no longer used.

SayIt uses no GPL, AGPL, SSPL, or other copyleft-licensed **code**. Engines evaluated
and rejected on licensing grounds: eSpeak NG and the `phonemizer` wrapper
(GPL-3.0-or-later), `ephone` (GPL-3.0-or-later), and
`@jocelyn-sticker/espeak-phonemes` (AGPL-3.0-or-later).

Audible playback is separate from IPA: it uses the browser's built-in Web Speech API,
with no bundled engine and no audio data.

## Dependencies

The shipped tree contains no copyleft **code** licenses. Every package the
application loads at runtime is MIT, Apache-2.0, BSD, ISC, or MIT-0. (One bundled
*dataset*, the wordfreq-derived word list, is CC BY-SA 4.0 — see
[Bundled data](#bundled-data).)

Complete runtime inventory, as resolved by `package-lock.json`:

| Package | Version | License |
| --- | --- | --- |
| `@asamuzakjp/css-color` | 3.2.0 | MIT |
| `@csstools/color-helpers` | 5.1.0 | MIT-0 |
| `@csstools/css-calc` | 2.1.4 | MIT |
| `@csstools/css-color-parser` | 3.1.0 | MIT |
| `@csstools/css-parser-algorithms` | 3.0.5 | MIT |
| `@csstools/css-tokenizer` | 3.0.4 | MIT |
| `@mozilla/readability` | 0.6.0 | Apache-2.0 |
| `agent-base` | 7.1.4 | MIT |
| `cssstyle` | 4.6.0 | MIT |
| `data-urls` | 5.0.0 | MIT |
| `debug` | 4.4.3 | MIT |
| `decimal.js` | 10.6.0 | MIT |
| `entities` | 6.0.1 | BSD-2-Clause |
| `html-encoding-sniffer` | 4.0.0 | MIT |
| `http-proxy-agent` | 7.0.2 | MIT |
| `https-proxy-agent` | 7.0.6 | MIT |
| `iconv-lite` | 0.6.3 | MIT |
| `is-potential-custom-element-name` | 1.0.1 | MIT |
| `jsdom` | 26.1.0 | MIT |
| `lru-cache` | 10.4.3 | ISC |
| `ms` | 2.1.3 | MIT |
| `number-to-words` | 1.2.5 | MIT |
| `nwsapi` | 2.2.28 | MIT |
| `parse5` | 7.3.0 | MIT |
| `phonemize` | 2.0.1 | MIT |
| `pinyin-pro` | 3.29.5 | MIT |
| `punycode` | 2.3.1 | MIT |
| `react` | 19.3.0 | MIT |
| `react-dom` | 19.3.0 | MIT |
| `rrweb-cssom` | 0.8.0 | MIT |
| `safer-buffer` | 2.1.2 | MIT |
| `saxes` | 6.0.0 | ISC |
| `scheduler` | 0.28.0 | MIT |
| `symbol-tree` | 3.2.4 | MIT |
| `tldts` | 6.1.86 | MIT |
| `tldts-core` | 6.1.86 | MIT |
| `tough-cookie` | 5.1.2 | BSD-3-Clause |
| `tr46` | 5.1.1 | MIT |
| `w3c-xmlserializer` | 5.0.0 | MIT |
| `webidl-conversions` | 7.0.0 | BSD-2-Clause |
| `whatwg-encoding` | 3.1.1 | MIT |
| `whatwg-mimetype` | 4.0.0 | MIT |
| `whatwg-url` | 14.2.0 | MIT |
| `ws` | 8.22.0 | MIT |
| `xml-name-validator` | 5.0.0 | Apache-2.0 |
| `xmlchars` | 2.2.0 | MIT |
| `zod` | 4.6.5 | MIT |

Build- and test-only packages (`devDependencies`) are not part of the shipped
application. Four of them carry their own notice obligations and are listed here for
completeness: `typescript`, `expect-type`, and `baseline-browser-mapping`
(Apache-2.0), and `caniuse-lite` (CC BY 4.0).

### Retaining notices in a binary distribution

Apache-2.0, BSD-2-Clause, BSD-3-Clause, and ISC all require their copyright notice,
license text, and disclaimer to be retained when the software is redistributed.
`npm install` places each package's own `LICENSE` file under `node_modules`, and those
files are the authoritative copyright lines — keep them with any binary
distribution.

`@mozilla/readability` (Apache-2.0, "Copyright (c) 2010 Arc90 Inc") and
`xml-name-validator` (Apache-2.0) ship no separate `NOTICE` file, so Apache-2.0
section 4(d) adds no extra attribution file; section 4(c) is satisfied by retaining
the `LICENSE.md` / `LICENSE.txt` already inside each package.

`npm run build` writes `dist/`, which is not committed and contains no license texts
of its own. If you publish a built bundle, ship this file and the retained `LICENSE`
files alongside it.

To reproduce the inventory yourself:

```powershell
npm ls --omit=dev --all
```

## Editor and tooling prompts

`.cursor/skills/` and `.cursor/commands/` contain generated prompt files from
[OpenSpec](https://github.com/Fission-AI/OpenSpec) (MIT), used during development
only. They are not part of the application.

## News content

SayIt's Reader shows **links, titles, publication names, reading metadata, and the
article body of pages that declare their own body as machine-readable full text**, so
that you can read them. Reader verifies that declaration before it stores or displays
a body, and it respects per-source cache permissions.

Article text and headlines remain the property of their publishers and are displayed
for the reader's personal use only. SayIt is not affiliated with, endorsed by, or
sponsored by any publisher whose work it surfaces. SayIt does not bypass paywalls,
logins, or robots restrictions, and it does not redistribute article bodies as a
dataset.

The `artifacts/` directory contains screenshots and recorded acceptance output from
SayIt's own development. Some of those images show a published headline together with
a short excerpt of the article body, and the acceptance records store source URLs,
titles, and content hashes. Those headlines, excerpts, and URLs belong to their
publishers and are reproduced only as evidence of what the software displayed.
