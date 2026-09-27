#!/usr/bin/env python3
"""Literature corpus for UrbanLM Lite: harvest → filter → tokenise → vectorise.

Reproduces research/corpus/* (1,104 papers in the 2026-09-27 run):
  1. Harvest abstracts from OpenAlex (title/abstract search, 130 queries) and
     fill thin topics from the Semantic Scholar Graph API.
  2. Deduplicate and keep domain-relevant papers (≥ 3 urban-design terms).
  3. Tokenise (lower-case, stop words, light plural stemming, title ×2) and
     build unigram + bigram TF-IDF (min_df 2, max_df 0.5, sublinear tf).
  4. LSA: truncated SVD → 128-d unit vectors; 2-d projection for plots.
  5. KMeans (k = 14, seed 7) topic clusters with top terms.
  6. Keyword / metric evidence: cosine similarity of query vectors in LSA space.
  7. Quantitative statements: sentences mentioning a metric (SVF, GVI, UTCI,
     PET, H/W, wind, dB, shade) together with numbers + units.

usage: pip install requests scikit-learn numpy scipy
       python research/scripts/build_corpus.py --out research/corpus --mailto you@example.org
Deterministic given the same API responses (all seeds fixed).
"""
import argparse, json, os, re, time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import requests
import scipy.sparse as sp
from sklearn.cluster import KMeans
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, TfidfVectorizer
from sklearn.preprocessing import normalize

QUERIES = [
    # broad pass (relevance sort)
    "isovist spatial experience", "visibility graph analysis architecture", "space syntax pedestrian movement",
    "urban perception street view deep learning", "street view imagery perception safety liveliness",
    "green view index wellbeing", "urban greenery mental health happiness", "sky view factor thermal comfort",
    "outdoor thermal comfort UTCI PET urban", "pedestrian wind comfort urban", "urban design qualities walkability measurement",
    "enclosure height width ratio street perception", "prospect refuge public space", "public space social interaction behavior mapping",
    "lively streets stationary activities", "soundscape urban public space pleasantness", "fractal dimension urban skyline preference",
    "restorative environments urban attention restoration", "urban happiness built environment", "subjective wellbeing neighborhood built environment",
    "place attachment public space design", "emotion mapping urban space", "physiological stress urban environment EEG",
    "virtual reality urban design perception experiment", "agent based model public space pedestrian", "social force model pedestrian simulation",
    "generative urban design optimization", "evolutionary algorithm urban layout optimization", "machine learning built environment perception SHAP",
    "graph neural network urban morphology", "urban morphology metrics building footprint", "walkability index built environment",
    "plaza design users behavior", "microclimate urban square design", "tree canopy shade pedestrian comfort",
    "street furniture seating use public space", "active frontage ground floor transparency", "visual complexity architecture preference",
    "legibility wayfinding urban image Lynch", "sense of place measurement", "perceived safety urban environment lighting",
    "urban density perception crowding", "Indian cities public space", "Ahmedabad urban", "heat stress hot dry climate urban form comfort",
    "parametric urban design environmental performance", "semantic segmentation street scene urban quality",
    "crowdsourcing urban perception pairwise comparison", "qualitative to quantitative urban design evaluation", "landscape preference visual quality assessment",
]
FILTER_QUERIES = [
    # title/abstract filter pass (citation sort)
    "isovist", "visibility graph analysis", "space syntax pedestrian", "space syntax public space", "urban perception street view",
    "street view image perception", "streetscape perception deep learning", "green view index", "street greenery mental health",
    "urban green space happiness", "urban green space wellbeing", "sky view factor", "outdoor thermal comfort urban geometry", "UTCI urban",
    "physiological equivalent temperature urban", "pedestrian wind comfort", "pedestrian level wind urban", "walkability urban design qualities",
    "street enclosure perception", "height to width ratio street canyon", "prospect refuge", "public space social interaction",
    "public space behavior observation", "stationary activities public space", "street liveliness", "urban vitality built environment",
    "soundscape urban park", "soundscape pleasantness", "fractal dimension skyline", "visual complexity facade", "restorative environment urban",
    "attention restoration urban", "happiness built environment", "subjective well-being urban form", "neighborhood built environment life satisfaction",
    "place attachment public space", "emotion urban space", "mobile EEG urban walking", "virtual reality streetscape perception",
    "immersive virtual environment urban design", "agent-based model public space", "pedestrian simulation urban design", "social force model pedestrian",
    "generative urban design", "urban layout optimization genetic algorithm", "multi-objective optimization urban form", "built environment perception SHAP",
    "explainable machine learning street perception", "graph neural network urban", "urban morphology building footprint metrics", "plaza design use",
    "urban square microclimate", "tree shade pedestrian thermal comfort", "street furniture seating public space", "ground floor frontage street activity",
    "landscape visual preference", "perceived safety street environment", "perceived crowding urban density", "Indian city public space", "Ahmedabad",
    "walled city Ahmedabad", "hot dry climate urban form comfort", "parametric urban design", "semantic segmentation streetscape",
    "pairwise comparison urban perception crowdsourcing", "urban design evaluation quantitative", "Kansei engineering urban space", "spatial openness perception",
    "visual quality urban street", "urban heat pedestrian perception", "informal street vending public space", "urban form mental health",
    "neighbourhood design sociability", "shade structure public space", "water feature urban public space perception", "color urban facade perception",
    "noise annoyance urban public space", "point cloud urban space analysis", "3D city model visibility analysis", "digital twin urban perception",
]
S2_GAPS = [
    "isovist", "isovist spatial experience", "visibility graph analysis space syntax", "street view urban perception deep learning",
    "place pulse urban perception", "green view index street", "attention restoration theory urban", "urban happiness",
    "perceived restorativeness urban", "prospect refuge", "urban design generative algorithm public space", "green space mental health urban",
    "street greenery wellbeing", "Kaplan mystery coherence landscape preference", "urban public space happiness wellbeing",
]
FIELDS = "id,doi,title,publication_year,cited_by_count,abstract_inverted_index,concepts,primary_location,authorships"
DOMAIN = re.compile(r"\b(urban|street|streetscape|city|cities|public space|pedestrian|built environment|neighbo(u)?rhood|plaza|square|park|isovist|space syntax|walkab|landscape|outdoor|architect|thermal comfort|soundscape|green space|greenery|townscape|placemaking|place-making|urban design|built form|morpholog)", re.I)
KEYWORD_QUERIES = {
    "happy": "happiness happy wellbeing joy emotion positive affect urban public space green",
    "calm": "calm tranquil quiet soundscape pleasantness restorative low noise",
    "lively": "lively vitality liveliness active frontage social activity street life vibrant",
    "safe": "perceived safety security crime surveillance eyes street visibility",
    "intimate": "enclosure intimate human scale small space courtyard sense of enclosure",
    "spacious": "openness spaciousness sky view open space visual openness",
    "restorative": "restorative attention restoration green space nature mental health stress",
    "mysterious": "mystery complexity exploration visual complexity isovist occlusion",
    "comfortable": "outdoor thermal comfort shade UTCI PET heat stress tree canopy",
    "legible": "legibility wayfinding imageability landmark cognitive map",
    "sociable": "social interaction seating stationary activities gathering public life",
    "active": "physical activity play exercise children playground open gym",
    "f_isovist": "isovist visibility visual field spatial experience", "f_svf": "sky view factor",
    "f_gvi": "green view index street greenery visible green", "f_utci": "UTCI PET thermal comfort index",
    "f_wind": "pedestrian wind comfort wind speed", "f_hw": "height width ratio street canyon aspect ratio enclosure",
    "f_frontage": "active frontage ground floor transparency shops", "f_seating": "seating benches street furniture sitting",
    "f_sound": "traffic noise sound level soundscape", "f_sun": "sunlight hours solar exposure shading",
}
QUANT_PATTERNS = {
    "svf": r"(sky[- ]view factor|\bSVF\b)", "gvi": r"(green view index|\bGVI\b|green view)", "utci": r"\bUTCI\b",
    "pet": r"\bPET\b|physiological equivalent temperature", "hw": r"(H/W|height[- ]to[- ]width|aspect ratio)",
    "wind": r"(wind speed|wind velocity|m/s)", "sound": r"(dB\(?A\)?|\bdBA\b|L\s?Aeq|LAeq)", "isovist": r"isovist",
    "tree": r"(tree canopy|canopy cover|tree cover|shade)",
}
NUM = re.compile(r"(-?\d+(?:\.\d+)?)\s*(?:–|-|to)?\s*(\d+(?:\.\d+)?)?\s*(°C|℃|m/s|%|dB\(?A\)?|dBA|m²|m2|m\b|K\b)?")
STOP = set(ENGLISH_STOP_WORDS) | {
    "study", "studies", "results", "paper", "research", "using", "used", "based", "analysis", "approach", "method", "methods", "data",
    "findings", "effect", "effects", "significant", "significantly", "also", "may", "however", "new", "provide", "provides", "present",
    "shows", "show", "found", "within", "among", "well", "different", "related", "use", "two", "one", "three", "can", "could", "various",
    "high", "higher", "low", "lower", "level", "levels", "proposed", "model", "models",
}


def inverted_to_text(ii):
    if not ii:
        return ""
    return " ".join(w for _, w in sorted((p, w) for w, ps in ii.items() for p in ps))


def openalex(query, mailto, filter_mode):
    out = []
    for page in (1, 2):
        if filter_mode:
            url = (f"https://api.openalex.org/works?filter=title_and_abstract.search:{requests.utils.quote(query)},has_abstract:true"
                   f"&per-page=50&page={page}&sort=cited_by_count:desc&select={FIELDS}&mailto={mailto}")
        else:
            url = (f"https://api.openalex.org/works?search={requests.utils.quote(query)}&filter=has_abstract:true"
                   f"&per-page=25&page={page}&sort=relevance_score:desc&select={FIELDS}&mailto={mailto}")
        for _ in range(3):
            r = requests.get(url, timeout=60)
            if r.status_code == 200:
                for w in r.json()["results"]:
                    out.append({
                        "id": w["id"].replace("https://openalex.org/", ""),
                        "doi": (w.get("doi") or "").replace("https://doi.org/", ""),
                        "t": w.get("title"), "y": w.get("publication_year"), "c": w.get("cited_by_count"),
                        "v": ((w.get("primary_location") or {}).get("source") or {}).get("display_name"),
                        "a": [a["author"]["display_name"] for a in (w.get("authorships") or [])[:3]],
                        "ab": inverted_to_text(w.get("abstract_inverted_index")), "q": [query],
                    })
                break
            time.sleep(3)
    return out


def semantic_scholar(query):
    for attempt in range(4):
        r = requests.get("https://api.semanticscholar.org/graph/v1/paper/search", timeout=40,
                         params={"query": query, "limit": 50, "fields": "title,abstract,year,citationCount,venue,authors,externalIds"})
        if r.status_code == 200:
            return [{
                "id": "S2:" + w["paperId"], "doi": (w.get("externalIds") or {}).get("DOI") or "", "t": w["title"], "y": w.get("year"),
                "c": w.get("citationCount"), "v": w.get("venue"), "a": [a["name"] for a in (w.get("authors") or [])[:3]],
                "ab": w["abstract"], "q": [query],
            } for w in r.json().get("data", []) if w.get("abstract")]
        time.sleep(3 * (attempt + 1))
    return []


def tokenize(text):
    out = []
    for w in re.findall(r"[a-z][a-z0-9]{1,}", text.lower().replace("-", " ")):
        if w in STOP:
            continue
        if len(w) > 4:
            if w.endswith("ies"):
                w = w[:-3] + "y"
            elif w.endswith("sses"):
                w = w[:-2]
            elif w.endswith("s") and not w.endswith(("ss", "us", "is")):
                w = w[:-1]
        if w not in STOP:
            out.append(w)
    return out


def with_bigrams(tokens):
    return tokens + [a + "_" + b for a, b in zip(tokens, tokens[1:])]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="research/corpus")
    ap.add_argument("--mailto", default="research@example.org")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    # 1. harvest
    with ThreadPoolExecutor(4) as ex:
        batches = list(ex.map(lambda q: openalex(q, args.mailto, False), QUERIES))
        batches += list(ex.map(lambda q: openalex(q, args.mailto, True), FILTER_QUERIES))
    for q in S2_GAPS:
        batches.append(semantic_scholar(q))
        time.sleep(1.5)

    # 2. dedupe + relevance filter
    papers, titles = {}, set()
    for p in (p for b in batches for p in b):
        key = (p["t"] or "").strip().lower()
        if p["id"] in papers:
            papers[p["id"]]["q"] = sorted(set(papers[p["id"]]["q"] + p["q"]))
        elif key and key not in titles:
            papers[p["id"]] = p
            titles.add(key)
    rel = lambda p: len(DOMAIN.findall((p["t"] or "") + " " + p["ab"]))
    corpus = sorted((p for p in papers.values() if len(p["ab"]) > 300 and rel(p) >= 3), key=lambda p: (-rel(p), p["id"]))
    print(f"harvested {len(papers)} unique, kept {len(corpus)} relevant")

    # 3. tokenise + TF-IDF
    docs = [f"{p['t'] or ''}. {p['t'] or ''}. {p['ab']}" for p in corpus]
    tokens = [tokenize(d) for d in docs]
    vec = TfidfVectorizer(analyzer=lambda d: d, min_df=2, max_df=0.5, sublinear_tf=True)
    X = vec.fit_transform([with_bigrams(t) for t in tokens])
    terms = np.array(vec.get_feature_names_out())

    # 4. LSA
    svd = TruncatedSVD(n_components=128, random_state=7, algorithm="arpack")
    Z = normalize(svd.fit_transform(X))
    xy = TruncatedSVD(n_components=2, random_state=7).fit_transform(Z)

    # 5. clusters
    km = KMeans(n_clusters=14, random_state=7, n_init=10).fit(Z)
    C = normalize(svd.inverse_transform(km.cluster_centers_))
    clusters = [{"id": c, "n": int((km.labels_ == c).sum()), "top": [str(t) for t in terms[np.argsort(-C[c])][:12]]} for c in range(14)]

    # 6. evidence
    def qvec(q):
        return normalize(svd.transform(vec.transform([with_bigrams(tokenize(q))])))[0]
    evidence = {}
    for k, q in KEYWORD_QUERIES.items():
        s = Z @ qvec(q)
        evidence[k] = [{"id": corpus[i]["id"], "score": round(float(s[i]), 3)} for i in np.argsort(-s)[:20]]

    # 7. quantitative statements
    quant = {k: [] for k in QUANT_PATTERNS}
    for p in corpus:
        for sent in re.split(r"(?<=[.;])\s+", p["ab"]):
            if not re.search(r"\d", sent):
                continue
            for k, pat in QUANT_PATTERNS.items():
                if re.search(pat, sent, re.I):
                    nums = [m.group(0).strip() for m in NUM.finditer(sent) if m.group(3) or "." in m.group(1)]
                    if nums:
                        quant[k].append({"id": p["id"], "y": p["y"], "s": sent[:400], "nums": nums[:8]})

    # write
    with open(f"{args.out}/papers.jsonl", "w") as f:
        for p, c in zip(corpus, km.labels_):
            f.write(json.dumps({**p, "cluster": int(c)}, ensure_ascii=False) + "\n")
    json.dump([{"id": p["id"], "tokens": t} for p, t in zip(corpus, tokens)], open(f"{args.out}/tokens.json", "w"))
    json.dump({"terms": terms.tolist(), "idf": np.round(vec.idf_, 4).tolist()}, open(f"{args.out}/vocab_idf.json", "w"))
    sp.save_npz(f"{args.out}/tfidf.npz", X)
    np.save(f"{args.out}/lsa128.npy", Z.astype(np.float32))
    np.save(f"{args.out}/xy2.npy", xy.astype(np.float32))
    json.dump(clusters, open(f"{args.out}/clusters.json", "w"), indent=1)
    json.dump(evidence, open(f"{args.out}/keyword_evidence.json", "w"), indent=1)
    json.dump(quant, open(f"{args.out}/quant_statements.json", "w"), indent=1, ensure_ascii=False)
    stats = {"papers": len(corpus), "tokens": int(sum(map(len, tokens))), "vocab": int(X.shape[1]),
             "lsaExplained": round(float(svd.explained_variance_ratio_.sum()), 3), "quantStatements": sum(map(len, quant.values()))}
    json.dump(stats, open(f"{args.out}/stats.json", "w"), indent=1)
    print(stats)


if __name__ == "__main__":
    main()
