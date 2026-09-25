# SayIt compact lexicon source and generation

The checked-in frequency ranking is derived from `wordfreq` 3.0.2 using
`top_n_list("en", 12000, wordlist="large", ascii_only=True)`. The source
wheel is pinned by URL and SHA-256 in `public/data/sayit-lexicon.manifest.json`;
the selected alphabetic list is separately checksum-locked by the generator.
The frequency data is distributed under CC BY-SA 4.0. The `wordfreq` code is
Apache-2.0. Attribution and source descriptions are retained in the manifest.

`sayit-lexicon.v1.json` glosses are generated from the first WordNet 3.0 sense
in the pinned `wordnet@2.0.0` package. For each part of speech, the first sense
is the `sense_number=1` entry from Princeton's `index.sense`; the generator
chooses the first sense with the greatest `tag_count` across parts of speech.
When no first sense has a tag count, it uses the documented fixed POS order.
Princeton notes that tag counts come from semantic concordances last updated in
2001, so this is a deterministic sense-selection heuristic rather than a claim
about current language frequency. Package integrity, official database archive
checksum, filtered sense-count input checksum, Princeton WordNet license, and
sense ordering are recorded in the manifest. The Princeton license notice is
shipped beside the artifact as `WORDNET-LICENSE.txt`.

The checked-in `wordnet-primary-sense-counts.tsv` contains only sense-number-1
tag counts for lemmas in the locked frequency list and SayIt golden set. It was
filtered from `dict/index.sense` in the official WordNet 3.0 database archive;
the exact upstream archive and file checksums are recorded in the manifest.

To regenerate, install the repository dependencies and run:

```sh
npm run lexicon:generate
```

The generator validates the selected frequency list checksum and the installed
WordNet package version, then writes a stable JSON artifact plus measured raw
and gzip sizes and SHA-256 hashes. It records the positive golden definitions,
the negative unknown-word check, and the five required morphology fallback
cases. Compact approval additionally requires the deterministic 100-gloss
spot-check to have been reviewed. After reviewing those entries from the
manifest, regenerate once with both review flags:

```sh
npm run lexicon:generate -- --spot-check-reviewed --approve-compact
```

Runtime code may only display the dictionary wording after metadata cleanup,
first-semicolon clause trimming, and a length cap. It must not paraphrase glosses.
