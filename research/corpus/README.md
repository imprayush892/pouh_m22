# Literature corpus (generated)

Built by `research/scripts/build_corpus.py` (harvest, tokenise, vectorise) and
`research/scripts/aggregate_evidence.py` (evidence matrix) on 2026-09-27.

| File | Contents |
|---|---|
| `papers.jsonl` | 1,104 papers: id (OpenAlex W… / Semantic Scholar S2:…), doi, title, year, citations, venue, authors, abstract, queries, topic cluster |
| `tokens.json` | tokenised abstracts (title ×2, stop words removed, light stemming) |
| `vocab_idf.json`, `tfidf.npz` | 24,569-term unigram+bigram vocabulary, IDF weights, sparse TF-IDF matrix (scipy.sparse npz) |
| `lsa128.npy` | 128-d LSA unit vectors per paper (row order = papers.jsonl) |
| `clusters.json` | 14 KMeans topics with top terms |
| `keyword_evidence.json` | top-20 papers per app keyword / metric (cosine in LSA space) |
| `quant_statements.json` | 325 sentences pairing a metric with numbers + units |
| `extractions.jsonl` | per-paper structured extraction (LLM over abstracts): relevant?, methods, outcomes, findings {parameter, outcome, direction, range, quote} |
| `evidence_matrix.json` | parameter × outcome × keyword aggregation: counts of +/−/nonlinear, consistency, papers, ranges, quotes |

Abstract-level only (no full texts). Extraction quality is that of an LLM reading an
abstract — use `quote` to verify a finding before citing it.
