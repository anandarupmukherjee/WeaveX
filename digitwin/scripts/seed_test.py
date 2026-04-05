#!/usr/bin/env python3
"""
Quick smoke test: send a sample text to the extraction pipeline
and verify Ollama + the domain analyser are working end-to-end.

Usage:
    cd backend
    source .venv/bin/activate
    python ../scripts/seed_test.py
"""

import asyncio
import json
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.utils.llm_client import OllamaClient
from app.services.extractors.domain_analyser import DomainAnalyser


SAMPLE_DOCUMENT = """
# City General Hospital — Emergency Department Operations Report

## Staffing
The ED operates 24/7 with three shifts: Day (7am-3pm), Evening (3pm-11pm),
Night (11pm-7am). Each shift is staffed with:
- 2 attending physicians (Dr. Sarah Chen, Dr. Marcus Williams on day shift)
- 4 registered nurses (led by Charge Nurse Patricia Lopez)
- 1 triage nurse
- 2 nursing assistants
- 1 unit clerk

## Patient Flow
Average daily census: 180 patients. Peak hours: 10am-2pm and 6pm-10pm.
Current average wait time from arrival to first physician contact: 47 minutes.
Target: under 30 minutes.

Triage categories (ESI 1-5):
- ESI 1 (Resuscitation): 2% — immediate
- ESI 2 (Emergent): 15% — within 10 min
- ESI 3 (Urgent): 45% — within 30 min
- ESI 4 (Less urgent): 28% — within 60 min
- ESI 5 (Non-urgent): 10% — within 120 min

## Bed Utilisation
Total beds: 42 (8 critical care, 20 acute, 14 fast-track)
Average occupancy: 87%. Bottleneck: bed turnaround time averaging 45 minutes
after patient discharge/transfer. Housekeeping delays are the primary cause.

## Key Issues
1. Boarding: admitted patients waiting 3-6 hours for inpatient beds
2. Left Without Being Seen (LWBS) rate: 4.2% (target: <2%)
3. Lab result turnaround: 55 minutes average (target: 30 minutes)
4. Radiology turnaround: 40 minutes average (target: 25 minutes)

## Recent Initiatives
- Implemented vertical patient flow (patients assessed standing)
- Added a physician-in-triage model during peak hours
- Installed real-time bed tracking dashboard
"""

SAMPLE_DESCRIPTION = """
I want to simulate the hospital emergency department described in this report.
The goal is to optimise patient wait times and reduce the LWBS rate.
I want to explore scenarios like a flu season surge (50% more patients)
and a staffing shortage (losing one physician per shift).
"""


async def test_ollama_connection():
    """Step 1: Verify Ollama is running and the model is available."""
    print("=" * 60)
    print("STEP 1: Testing Ollama connection")
    print("=" * 60)

    llm = OllamaClient()
    ok = await llm.check_model()

    if ok:
        print(f"  ✓ Model '{llm.model}' is available on Ollama")
    else:
        print(f"  ✗ Model '{llm.model}' NOT found.")
        print(f"    Run: ollama pull {llm.model}")
        return False

    # Quick chat test
    print("  Testing basic chat...")
    response = await llm.chat([
        {"role": "system", "content": "You are a helpful assistant. Be very brief."},
        {"role": "user", "content": "Say 'hello' and nothing else."},
    ], temperature=0.1, max_tokens=20)
    print(f"  ✓ Response: {response.strip()}")
    return True


async def test_json_output():
    """Step 2: Verify the model can produce valid JSON."""
    print("\n" + "=" * 60)
    print("STEP 2: Testing JSON output")
    print("=" * 60)

    llm = OllamaClient()
    result = await llm.chat_json([
        {"role": "system", "content": "You are a JSON generator."},
        {"role": "user", "content": 'Return a JSON object with keys "name" and "count".'},
    ])
    print(f"  ✓ Got valid JSON: {json.dumps(result)}")
    return True


async def test_extraction_pipeline():
    """Step 3: Run the full 4-pass extraction pipeline."""
    print("\n" + "=" * 60)
    print("STEP 3: Running full extraction pipeline")
    print("  (This may take 1-3 minutes with a local model)")
    print("=" * 60)

    analyser = DomainAnalyser()

    def on_progress(stage: str, detail: str):
        print(f"  [{stage}] {detail}")

    twin_spec = await analyser.analyse(
        documents=[SAMPLE_DOCUMENT],
        user_description=SAMPLE_DESCRIPTION,
        on_progress=on_progress,
    )

    print(f"\n  ✓ EXTRACTION COMPLETE")
    print(f"    Domain:       {twin_spec.intent.domain}")
    print(f"    Model type:   {twin_spec.intent.model_type}")
    print(f"    Entity types: {len(twin_spec.ontology.entity_types)}")
    print(f"    Relations:    {len(twin_spec.ontology.relation_types)}")
    print(f"    Agents:       {len(twin_spec.agents)}")
    print(f"    Interactions: {len(twin_spec.interactions)}")
    print(f"    Tools:        {len(twin_spec.tools)}")
    print(f"    Objectives:   {len(twin_spec.objectives)}")

    print(f"\n  Agents extracted:")
    for a in twin_spec.agents:
        print(f"    - {a.name} ({a.entity_type}) — {len(a.tool_names)} tools")

    print(f"\n  Interactions:")
    for p in twin_spec.interactions:
        print(f"    - {p.name}: {p.trigger}")

    print(f"\n  Tools:")
    for t in twin_spec.tools:
        print(f"    - {t.name}: {t.description[:60]}")

    # Save full output
    output_path = os.path.join(os.path.dirname(__file__), "test_output.json")
    with open(output_path, "w") as f:
        json.dump(twin_spec.model_dump(), f, indent=2, default=str)
    print(f"\n  Full output saved to: {output_path}")

    return True


async def main():
    print("\n🔬 DigiTwin — Extraction Pipeline Smoke Test\n")

    # Step 1
    if not await test_ollama_connection():
        print("\n❌ Ollama not available. Fix this first.")
        sys.exit(1)

    # Step 2
    try:
        await test_json_output()
    except Exception as e:
        print(f"  ✗ JSON test failed: {e}")
        print("  The model may not support structured output well.")
        print("  Try a larger model: ollama pull gemma4:26b")
        sys.exit(1)

    # Step 3
    try:
        await test_extraction_pipeline()
    except Exception as e:
        print(f"\n  ✗ Extraction pipeline failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    print("\n" + "=" * 60)
    print("✅ ALL TESTS PASSED — pipeline is working!")
    print("=" * 60)
    print("\nNext steps:")
    print("  1. Start the backend:  cd backend && uvicorn app.main:app --reload --port 5001")
    print("  2. Start the frontend: cd frontend && npm run dev")
    print("  3. Open http://localhost:5173 and upload your own documents")


if __name__ == "__main__":
    asyncio.run(main())
