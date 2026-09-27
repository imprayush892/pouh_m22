#!/usr/bin/env python3
"""Structured extraction of methods, outcomes and parameter→outcome findings
from every abstract in research/corpus/papers.jsonl (run on 2026-09-27 over
1,104 papers; output research/corpus/extractions.jsonl).

The extraction used an LLM (`llm(prompt) -> str`) with the prompt below, one
call per paper, JSON-only output. Plug in any chat-completion client; keep
temperature at 0 for repeatability. Then run aggregate_evidence.py.

usage: python extract_findings.py papers.jsonl extractions.jsonl
"""
import json, re, sys
from concurrent.futures import ThreadPoolExecutor

PARAMS = ("isovist_area, isovist_openness, visual_complexity, occlusion_mystery, visibility_integration, space_syntax_integration, "
          "space_syntax_choice, street_connectivity, block_size, enclosure_height_width, building_height, building_height_variation, "
          "building_density_coverage, floor_area_ratio, setback, street_width, sidewalk_width, open_space_area, open_space_proportion, "
          "sky_view_factor, green_view_index, tree_canopy_cover, vegetation_ndvi, lawn_grass, water_presence, blue_space_view, "
          "sun_exposure_hours, shade_coverage, air_temperature, mean_radiant_temperature, utci, pet, humidity, wind_speed, surface_albedo, "
          "surface_temperature, noise_level_db, natural_sounds, traffic_volume, distance_to_road, active_frontage, facade_transparency_windows, "
          "land_use_mix, commercial_density, poi_density, street_furniture_seating, lighting, cleanliness_maintenance, paving_material, "
          "facade_colour, facade_articulation, historic_buildings, landmarks, public_art, people_density_presence, vehicles_parking, "
          "pedestrian_flow, accessibility_distance, fractal_dimension, skyline")
METHODS = ("isovist, visibility_graph, space_syntax, street_view_segmentation, pairwise_crowdsourcing, survey_likert, expert_rating, "
           "behaviour_observation, physiological_measurement, vr_experiment, field_microclimate_measurement, microclimate_simulation, cfd, "
           "regression, machine_learning, deep_learning, explainable_ml_shap, agent_based_model, gis_morphometrics, optimisation_generative, "
           "qualitative_interview, review_meta_analysis")
OUTCOMES = ("happiness, wellbeing_mental_health, stress, safety, liveliness_vitality, restorativeness, thermal_comfort, wind_comfort, "
            "acoustic_pleasantness, beauty_aesthetic, preference, enclosure_perception, spaciousness, walkability_walking, social_interaction, "
            "stationary_activity_use, physical_activity, place_attachment, wayfinding_legibility, crowding")
PROMPT = """You extract structured evidence from an urban-design research abstract. Return ONLY JSON, no prose.
Schema:
{"relevant": true|false,            // does it relate PHYSICAL/ENVIRONMENTAL parameters of space to human PERCEPTION, FEELING, COMFORT or BEHAVIOUR?
 "methods": [..],                    // from: %s
 "outcomes": [..],                   // from: %s
 "findings": [                       // only relationships actually stated in the abstract; max 8
   {"parameter": "...",              // canonical name from: %s ; else "other:<short_name>"
    "outcome": "...",                // canonical outcome from the outcomes list, or "other:<short_name>"
    "direction": "+"|"-"|"nonlinear"|"none",   // effect of MORE of the parameter on the outcome
    "low": number|null, "high": number|null, "unit": "..."|null,  // threshold / optimal range / tested range if numbers are given
    "quote": "<= 25 words from the abstract"}],
 "setting": "city/country or null", "n": "sample size or null"}
TITLE: %%s
ABSTRACT: %%s""" % (METHODS, OUTCOMES, PARAMS)


def llm(prompt):  # replace with your client, e.g. Anthropic Messages API at temperature 0
    raise NotImplementedError


def extract(p):
    for _ in range(3):
        try:
            txt = llm(PROMPT % (p['t'], p['ab'][:3500]))
            rec = json.loads(re.search(r'\{.*\}', txt, re.S).group(0))
            rec['id'] = p['id']
            return rec
        except Exception:
            continue
    return {'id': p['id'], 'relevant': False, 'error': True}


if __name__ == '__main__':
    papers = [json.loads(l) for l in open(sys.argv[1])]
    with ThreadPoolExecutor(10) as ex:
        recs = list(ex.map(extract, papers))
    with open(sys.argv[2], 'w') as f:
        for r in recs:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')
