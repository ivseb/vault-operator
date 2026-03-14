"""
Template Analyzer -- Streamlit UI

Simple web interface for analyzing PPTX templates.
Run with: streamlit run app.py
"""

from __future__ import annotations

import streamlit as st
from pathlib import Path
import tempfile
import os
import requests

st.set_page_config(
    page_title="Obsilo Template Analyzer",
    page_icon=None,
    layout="centered",
)

st.title("Obsilo Template Analyzer")
st.markdown("Analysiert eine PPTX-Vorlage und erzeugt ein Visual Design Language Skill-Dokument.")

# ---------------------------------------------------------------------------
#  Model Picker (like Obsilo)
# ---------------------------------------------------------------------------

# Curated suggestions (same IDs as Obsilo's MODEL_SUGGESTIONS for OpenRouter)
DEFAULT_MODELS = {
    "Anthropic": [
        ("anthropic/claude-opus-4-6", "Claude Opus 4.6"),
        ("anthropic/claude-sonnet-4-5", "Claude Sonnet 4.5"),
        ("anthropic/claude-sonnet-4-5-20250514", "Claude Sonnet 4.5 (2025-05-14)"),
        ("anthropic/claude-3-7-sonnet-20250219", "Claude 3.7 Sonnet"),
        ("anthropic/claude-3.5-sonnet", "Claude 3.5 Sonnet"),
    ],
    "OpenAI": [
        ("openai/gpt-5", "GPT-5"),
        ("openai/gpt-4.1", "GPT-4.1"),
        ("openai/gpt-4o", "GPT-4o"),
    ],
    "Google": [
        ("google/gemini-2.5-pro-preview", "Gemini 2.5 Pro"),
        ("google/gemini-2.5-flash-preview", "Gemini 2.5 Flash"),
    ],
}


def fetch_openrouter_models(api_key: str | None = None) -> dict[str, list[tuple[str, str]]]:
    """Fetch available models from OpenRouter API, grouped by vendor."""
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        resp = requests.get("https://openrouter.ai/api/v1/models", headers=headers, timeout=10)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        st.warning(f"Konnte Modelle nicht von OpenRouter laden: {e}")
        return {}

    # Filter: only models with vision/multimodal capability
    grouped: dict[str, list[tuple[str, str, float]]] = {}
    for model in data.get("data", []):
        model_id = model.get("id", "")
        name = model.get("name", model_id)

        # Extract vendor from ID prefix
        vendor = model_id.split("/")[0] if "/" in model_id else "Other"
        vendor = vendor.replace("ai", "AI").title()

        # Get pricing for display
        pricing = model.get("pricing", {})
        prompt_price = float(pricing.get("prompt", "0") or "0") * 1_000_000  # per 1M tokens

        if vendor not in grouped:
            grouped[vendor] = []
        grouped[vendor].append((model_id, f"{name} (${prompt_price:.2f}/1M)", prompt_price))

    # Sort within groups by price, keep only top entries per vendor
    result: dict[str, list[tuple[str, str]]] = {}
    for vendor, models in sorted(grouped.items()):
        models.sort(key=lambda x: x[2])
        result[vendor] = [(m[0], m[1]) for m in models[:20]]  # Limit per vendor

    return result


# --- API Key ---
api_key = st.text_input(
    "OpenRouter API Key",
    type="password",
    placeholder="sk-or-...",
    help="Dein OpenRouter API Key. Wird nicht gespeichert. Erstelle einen unter openrouter.ai/keys",
)

# Test connection button
if api_key:
    if st.button("Verbindung testen"):
        try:
            import openai as _oai
            test_client = _oai.OpenAI(
                base_url="https://openrouter.ai/api/v1",
                api_key=api_key,
                default_headers={
                    "HTTP-Referer": "https://obsilo.ai",
                    "X-Title": "Obsilo Template Analyzer",
                },
            )
            resp = test_client.chat.completions.create(
                model="anthropic/claude-3.5-sonnet",
                max_tokens=20,
                messages=[{"role": "user", "content": "Say OK"}],
            )
            if resp.choices:
                st.success(f"Verbindung OK: {resp.choices[0].message.content}")
            else:
                st.error(f"Keine Antwort. Response: {resp}")
        except Exception as e:
            st.error(f"Verbindungsfehler: {e}")

# --- Model Picker ---
st.subheader("Modell")

# Initialize session state for models
if "fetched_models" not in st.session_state:
    st.session_state.fetched_models = None

col_fetch, col_info = st.columns([1, 3])
with col_fetch:
    if st.button("Modelle laden", help="Lade verfuegbare Modelle von OpenRouter"):
        with st.spinner("Lade Modelle..."):
            st.session_state.fetched_models = fetch_openrouter_models(api_key or None)
        if st.session_state.fetched_models:
            total = sum(len(v) for v in st.session_state.fetched_models.values())
            st.success(f"{total} Modelle geladen")
with col_info:
    st.caption("Oder waehle aus den Vorschlaegen")

# Build model options
models_source = st.session_state.fetched_models or DEFAULT_MODELS

# Flatten for selectbox with group headers
model_options: list[str] = []
model_labels: dict[str, str] = {}

for vendor, models in models_source.items():
    for model_id, label in models:
        display = f"{vendor} / {label}"
        model_options.append(model_id)
        model_labels[model_id] = display

# Find default index (Claude Sonnet 4.5)
default_idx = 0
for i, mid in enumerate(model_options):
    if "claude-sonnet-4-5" in mid and "20250514" not in mid:
        default_idx = i
        break

selected_model = st.selectbox(
    "Modell waehlen",
    options=model_options,
    index=default_idx,
    format_func=lambda x: model_labels.get(x, x),
    help="Sonnet 4.5 bietet das beste Preis-Leistungs-Verhaeltnis fuer Template-Analyse.",
)

# Show selected model ID
st.caption(f"Model-ID: `{selected_model}`")

# --- File upload ---
st.subheader("Vorlage")
uploaded_file = st.file_uploader(
    "PPTX-Vorlage hochladen",
    type=["pptx", "potx"],
    help="Die PowerPoint-Vorlage, die analysiert werden soll.",
)

# --- Analyze button ---
st.markdown("---")
if st.button("Analysieren", type="primary", disabled=not (api_key and uploaded_file)):
    if not api_key:
        st.error("Bitte OpenRouter API Key eingeben.")
    elif not uploaded_file:
        st.error("Bitte eine PPTX-Datei hochladen.")
    else:
        # Save uploaded file to temp
        with tempfile.TemporaryDirectory() as tmp_dir:
            pptx_path = os.path.join(tmp_dir, uploaded_file.name)
            with open(pptx_path, "wb") as f:
                f.write(uploaded_file.getvalue())

            # Progress
            status_text = st.empty()
            warnings_log: list[str] = []

            def on_progress(msg: str) -> None:
                status_text.text(msg)
                if "Warnung" in msg or "Fehler" in msg or "API-Fehler" in msg:
                    warnings_log.append(msg)

            try:
                from analyze import run_pipeline

                with st.spinner("Analyse laeuft..."):
                    vdl_content, result = run_pipeline(
                        pptx_path,
                        api_key,
                        model=selected_model,
                        on_progress=on_progress,
                    )

                status_text.empty()

                # Show warnings if any
                if warnings_log:
                    with st.expander(f"{len(warnings_log)} Warnungen waehrend der Analyse", expanded=True):
                        for w in warnings_log:
                            st.warning(w)

                # Success
                st.success(
                    f"Analyse abgeschlossen: {result.slide_count} Slides, "
                    f"{len(result.compositions)} Kompositionen, "
                    f"{len(vdl_content)} Zeichen"
                )

                # Check size limit
                if len(vdl_content) > 16000:
                    st.warning(
                        f"Das Skill-Dokument hat {len(vdl_content)} Zeichen und ueberschreitet "
                        f"das 16.000-Zeichen-Limit von Obsilo. Es sollte gekuerzt werden."
                    )

                # Show result
                st.subheader("Visual Design Language Skill")
                st.code(vdl_content, language="markdown")

                # Download button
                skill_filename = Path(uploaded_file.name).stem + "-skill.md"
                st.download_button(
                    label="SKILL.md herunterladen",
                    data=vdl_content,
                    file_name=skill_filename,
                    mime="text/markdown",
                )

                # Brand DNA preview
                with st.expander("Brand-DNA Details"):
                    dna = result.brand_dna
                    if dna.colors:
                        cols = st.columns(min(len(dna.colors), 6))
                        for i, (name, hex_color) in enumerate(list(dna.colors.items())[:6]):
                            with cols[i % len(cols)]:
                                st.markdown(
                                    f'<div style="background-color:{hex_color};width:40px;height:40px;'
                                    f'border-radius:4px;border:1px solid #ccc;margin-bottom:4px;"></div>'
                                    f'<small>{name}: {hex_color}</small>',
                                    unsafe_allow_html=True,
                                )
                    st.text(f"Heading: {dna.fonts.get('major', '?')}")
                    st.text(f"Body: {dna.fonts.get('minor', '?')}")

                # Compositions overview
                with st.expander("Kompositionen"):
                    for comp in result.compositions:
                        if comp.classification == "blank":
                            continue
                        st.markdown(
                            f"**{comp.composition_name}** ({comp.classification}) "
                            f"-- Slides: {', '.join(str(n) for n in comp.slide_numbers)}"
                        )
                        st.text(f"  Bedeutung: {comp.meaning}")
                        st.text(f"  Einsetzen: {comp.use_when}")

            except Exception as e:
                status_text.empty()
                st.error(f"Fehler: {e}")
                import traceback
                st.code(traceback.format_exc())

# --- Footer ---
st.markdown("---")
st.markdown(
    "<small>Obsilo Template Analyzer -- "
    "API Key wird nur fuer die aktuelle Analyse verwendet und nicht gespeichert. "
    "Modelle werden ueber <a href='https://openrouter.ai'>OpenRouter</a> aufgerufen.</small>",
    unsafe_allow_html=True,
)
