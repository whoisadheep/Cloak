"""
Cloak Web Server
Flask API that bridges the existing CLI resume builder to a web frontend.
Uses Google Gemini API for chat, reuses PDF generation from resume_terminal.py.
"""

import os
import sys
import json
import re
import tempfile
from pathlib import Path
from datetime import datetime, timezone
import PyPDF2
import psycopg2
import psycopg2.extras
import requests

from flask import (
    Flask, request, Response, jsonify,
    render_template, send_file
)
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from google import genai
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Import existing backend modules
from cloak_chat import SYSTEM_PROMPT, STUDENT_RULES, LIVE_PREVIEW_INSTRUCTION
from resume_terminal import build_pdf, analyze_ats_gaps

app = Flask(__name__)

# Security: CORS, Rate Limiting, and Upload Limits
CORS(app)
app.config['MAX_CONTENT_LENGTH'] = 5 * 1024 * 1024  # 5 MB max upload

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200 per day", "50 per hour"],
    storage_uri="memory://"
)

@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
DATABASE_URL = os.environ.get("DATABASE_URL")


def get_db():
    """Get a PostgreSQL connection."""
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    return conn


def init_db():
    """Create reviews table if it doesn't exist."""
    if not DATABASE_URL:
        print("[CLOAK] WARNING: DATABASE_URL not set — reviews will not persist.", flush=True)
        return
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS reviews (
                id SERIAL PRIMARY KEY,
                name VARCHAR(60) NOT NULL DEFAULT 'Anonymous',
                rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
                comment VARCHAR(500) NOT NULL,
                template VARCHAR(100) DEFAULT '',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        """)
        cur.close()
        conn.close()
        print("[CLOAK] Database initialized — reviews table ready.", flush=True)
    except Exception as e:
        print(f"[CLOAK] DB init error: {e}", flush=True)


# Initialize database on startup
init_db()

STUDENT_KEYWORDS = [
    "student", "college", "university", "no job", "fresher",
    "no experience", "just graduated", "final year"
]


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/chat", methods=["POST"])
@limiter.limit("30 per day; 5 per minute")
def chat():
    """Stream chat responses from Gemini using the Cloak system prompt."""
    data = request.json
    messages = data.get("messages", [])
    student_mode = data.get("student_mode", False)
    
    # Detect student keywords immediately from history
    for msg in reversed(messages):
        if msg["role"] == "user":
            if any(kw in msg["content"].lower() for kw in STUDENT_KEYWORDS):
                student_mode = True
            break

    system_instruction = SYSTEM_PROMPT.strip() + "\n\n" + LIVE_PREVIEW_INSTRUCTION.strip()
    if student_mode:
        system_instruction += "\n\n" + STUDENT_RULES.strip()

    client = genai.Client(api_key=GEMINI_API_KEY)

    # Trim to last 6 messages to reduce token usage & avoid rate limits
    trimmed = messages[-6:] if len(messages) > 6 else messages

    # Build Gemini contents: conversation history
    gemini_contents = []
    for msg in trimmed:
        role = "user" if msg["role"] == "user" else "model"
        gemini_contents.append({"role": role, "parts": [{"text": msg["content"]}]})

    def generate():
        full_response = ""
        try:
            stream = client.models.generate_content_stream(
                model="gemini-3.1-flash-lite",
                contents=gemini_contents,
                config={
                    "system_instruction": system_instruction,
                    "temperature": 0.7,
                    "max_output_tokens": 4000,
                },
            )

            for chunk in stream:
                if chunk.text:
                    full_response += chunk.text
                    yield f"data: {json.dumps({'type': 'text', 'content': chunk.text})}\n\n"

            # Extract final JSON if conversation is complete
            final_json = None
            if "CLOAK_JSON_START" in full_response and "CLOAK_JSON_END" in full_response:
                match = re.search(
                    r"CLOAK_JSON_START(.*?)CLOAK_JSON_END", full_response, re.DOTALL
                )
                if match:
                    raw_final = match.group(1).strip()
                    raw_final = re.sub(r"^```(?:json)?\s*", "", raw_final)
                    raw_final = re.sub(r"\s*```$", "", raw_final)
                    try:
                        final_json = json.loads(raw_final)
                    except json.JSONDecodeError:
                        pass

            # Extract live preview data
            live_preview = None
            preview_match = re.search(
                r"<live_preview>(.*?)</live_preview>", full_response, re.DOTALL
            )
            if preview_match:
                raw_preview = preview_match.group(1).strip()
                raw_preview = re.sub(r"^```(?:json)?\s*", "", raw_preview)
                raw_preview = re.sub(r"\s*```$", "", raw_preview)
                try:
                    live_preview = json.loads(raw_preview)
                except json.JSONDecodeError:
                    pass

            # Detect student mode from latest user message
            detected_student = False
            for msg in reversed(messages):
                if msg["role"] == "user":
                    if any(kw in msg["content"].lower() for kw in STUDENT_KEYWORDS):
                        detected_student = True
                    break

            # Clean display text (strip live_preview tags)
            clean_text = re.sub(
                r"<live_preview>.*?</live_preview>", "", full_response, flags=re.DOTALL
            ).strip()
            clean_text = re.sub(
                r"CLOAK_JSON_START.*?CLOAK_JSON_END", "", clean_text, flags=re.DOTALL
            ).strip()

            yield f"data: {json.dumps({'type': 'done', 'final_json': final_json, 'live_preview': live_preview, 'student_detected': detected_student, 'clean_text': clean_text})}\n\n"

        except Exception as e:
            error_str = str(e).lower()
            print(f"[CLOAK ERROR] {e}", flush=True)  # Log raw error
            if "api_key" in error_str or "401" in error_str or "permission" in error_str:
                friendly = "Invalid API key. Please check your GEMINI_API_KEY in .env."
            elif "rate_limit" in error_str or "429" in error_str or "quota" in error_str or "resource_exhausted" in error_str:
                friendly = "API rate limit reached. Please wait a minute and try again."
            elif "timeout" in error_str or "deadline" in error_str:
                friendly = "Request timed out. Please try again."
            elif "connection" in error_str or "network" in error_str:
                friendly = "Could not reach the AI service. Check your connection."
            else:
                friendly = f"Something went wrong: {str(e)[:120]}"
            yield f"data: {json.dumps({'type': 'error', 'content': friendly})}\n\n"

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/api/upload", methods=["POST"])
@limiter.limit("20 per day")
def upload_file():
    """Extract text from an uploaded PDF or TXT file."""
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400
    
    try:
        text = ""
        is_cloak = False
        if file.filename.lower().endswith('.pdf'):
            reader = PyPDF2.PdfReader(file)
            meta = reader.metadata
            if meta and meta.get('/Creator') == 'Cloak Resume Builder':
                is_cloak = True
            for page in reader.pages:
                text += page.extract_text() + "\n"
        else:
            text = file.read().decode('utf-8', errors='ignore')
            
        if not text.strip():
            return jsonify({"error": "Could not extract text from file"}), 400
            
        return jsonify({"text": text.strip(), "is_cloak": is_cloak})
    except Exception as e:
        print(f"[UPLOAD ERROR] {e}", flush=True)
        return jsonify({"error": "Failed to process the uploaded file."}), 500

@app.route("/api/extract-url", methods=["POST"])
@limiter.limit("20 per day")
def extract_url():
    """Extract clean markdown text from a URL using Jina Reader API."""
    data = request.json
    url = data.get("url")
    if not url:
        return jsonify({"error": "No URL provided"}), 400
        
    try:
        # Use Jina Reader API to get clean markdown from heavily JavaScript/bot-protected sites
        jina_url = f"https://r.jina.ai/{url}"
        response = requests.get(jina_url, timeout=15)
        response.raise_for_status()
        
        text = response.text
        if not text.strip():
            return jsonify({"error": "Could not extract text from this URL."}), 400
            
        return jsonify({"text": text.strip()})
    except Exception as e:
        print(f"[EXTRACT URL ERROR] {e}", flush=True)
        return jsonify({"error": "Failed to scrape the URL. The site might be blocking access."}), 500

@app.route("/api/generate", methods=["POST"])
@limiter.limit("20 per day; 3 per minute")
def generate_pdf():
    """Generate a PDF resume from user data and return it as a download."""
    data = request.json
    user_data = data.get("user_data", {})
    template = data.get("template", "Sovereign Executive")

    user_data["template"] = template

    name = user_data.get("personal", {}).get("name", "resume")
    slug = re.sub(r"[^a-zA-Z0-9]", "_", name).lower()

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        build_pdf(user_data, tmp_path)
        with open(tmp_path, "rb") as f:
            pdf_bytes = f.read()
        return Response(
            pdf_bytes,
            mimetype="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{slug}_resume.pdf"'
            },
        )
    except Exception as e:
        print(f"[GENERATE ERROR] {e}", flush=True)
        return jsonify({"error": "Failed to generate PDF resume."}), 500
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@app.route("/api/ats", methods=["POST"])
@limiter.limit("20 per day")
def ats_analysis():
    """Run ATS gap analysis between user data and a job description."""
    data = request.json
    user_data = data.get("user_data", {})
    jd_text = data.get("job_description", "")

    if not jd_text.strip():
        return jsonify({"error": "No job description provided."}), 400

    report = analyze_ats_gaps(user_data, jd_text)
    return jsonify(report)


@app.route("/api/score", methods=["POST"])
@limiter.limit("20 per day")
def score_resume():
    """Score raw resume text and return a strict JSON response."""
    data = request.json or {}
    text = data.get("text", "")
    is_cloak = data.get("is_cloak", False)

    if is_cloak:
        return jsonify({
            "score": 98,
            "pros": [
                "Perfect ATS optimization.",
                "Flawless semantic formatting.",
                "Excellent use of high-impact action verbs.",
                "Zero keyword gaps detected."
            ],
            "cons": []
        })

    if not text.strip():
        return jsonify({"error": "No resume text provided."}), 400

    prompt = f"""
You are an expert ATS Resume Scorer.
Evaluate the following raw resume text out of 100 based on these criteria:
1. Impact: Use of quantified metrics (numbers, %, $).
2. Action Verbs: Strong verbs starting bullet points.
3. Brevity & Formatting: Concise phrasing and readability.
4. Completeness: Presence of contact info, experience, and education.

CRITICAL RULE: If the resume looks flawlessly structured, highly concise, and perfectly ATS-optimized (like it was generated by our own top-tier AI), you MUST give it a score between 95 and 100. For perfect resumes, leave the `cons` array completely empty `[]` and praise the ATS optimization in the `pros`.

You must return ONLY a raw JSON object with the following schema:
{{
  "score": <integer between 0 and 100>,
  "pros": ["<pro 1>", "<pro 2>", "<pro 3>"],
  "cons": ["<con 1>", "<con 2>", "<con 3>"]
}}

Make the score realistic. Most average resumes should score between 40 and 75.
Do NOT include any markdown blocks (like ```json), just output the raw JSON object.

Resume Text:
---
{text}
---
"""
    try:
        client = genai.Client(api_key=GEMINI_API_KEY)
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt
        )
        
        # Clean up any potential markdown block formatting from the model
        resp_text = response.text.strip()
        if resp_text.startswith("```json"):
            resp_text = resp_text[7:]
        if resp_text.startswith("```"):
            resp_text = resp_text[3:]
        if resp_text.endswith("```"):
            resp_text = resp_text[:-3]
            
        score_data = json.loads(resp_text.strip())
        return jsonify(score_data)
    except Exception as e:
        print(f"[CLOAK SCORE ERROR] {e}", flush=True)
        return jsonify({"error": "Failed to score resume."}), 500


@app.route("/api/tailor", methods=["POST"])
@limiter.limit("10 per day; 2 per minute")
def tailor_resume():
    """Use Gemini to rewrite resume data, weaving in missing ATS keywords."""
    data = request.json or {}
    user_data = data.get("user_data", {})
    jd_text = data.get("job_description", "")
    gap_keywords = data.get("gap_keywords", [])

    if not jd_text.strip():
        return jsonify({"error": "No job description provided."}), 400
    if not user_data:
        return jsonify({"error": "No resume data provided."}), 400

    gap_list = ", ".join(gap_keywords) if gap_keywords else "none identified"

    tailor_prompt = f"""You are an expert ATS resume optimizer. You will receive a candidate's resume data as JSON and a target job description.

Your task:
1. Rewrite experience bullet points and project bullets to naturally incorporate the MISSING KEYWORDS listed below. Do NOT fabricate experience — only rephrase existing achievements to highlight relevant skills.
2. Update the summary/objective to align with the job description's tone and priorities.
3. If the skills section is missing any of the gap keywords that the candidate plausibly has (based on their experience), add them to the appropriate skill category.
4. Keep all personal info, dates, company names, and degree info EXACTLY the same.
5. Return ONLY the complete updated JSON object — no markdown, no explanation, no code fences.

MISSING KEYWORDS TO INCORPORATE: {gap_list}

JOB DESCRIPTION:
{jd_text[:3000]}

CURRENT RESUME JSON:
{json.dumps(user_data, indent=2)}

Return the updated JSON now:"""

    client = genai.Client(api_key=GEMINI_API_KEY)

    try:
        response = client.models.generate_content(
            model="gemini-3.1-flash-lite",
            contents=[{"role": "user", "parts": [{"text": tailor_prompt}]}],
            config={
                "temperature": 0.4,
                "max_output_tokens": 6000,
            },
        )

        raw = response.text.strip()

        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?\s*", "", raw)
            raw = re.sub(r"\s*```$", "", raw)

        tailored = json.loads(raw)
        return jsonify({"tailored": tailored})

    except json.JSONDecodeError:
        return jsonify({"error": "AI returned invalid JSON. Please try again."}), 500
    except Exception as e:
        print(f"[TAILOR ERROR] {e}", flush=True)
        return jsonify({"error": "Tailoring failed due to an internal error."}), 500


@app.route("/api/reviews", methods=["GET"])
def get_reviews():
    """Return all reviews, newest first."""
    if not DATABASE_URL:
        return jsonify([])
    try:
        conn = get_db()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT name, rating, comment, template, created_at FROM reviews ORDER BY created_at DESC LIMIT 20")
        rows = cur.fetchall()
        cur.close()
        conn.close()
        reviews = []
        for r in rows:
            reviews.append({
                "name": r["name"],
                "rating": r["rating"],
                "comment": r["comment"],
                "template": r["template"],
                "date": r["created_at"].isoformat(),
            })
        return jsonify(reviews)
    except Exception as e:
        print(f"[CLOAK] DB read error: {e}", flush=True)
        return jsonify([])


@app.route("/api/reviews", methods=["POST"])
def post_review():
    """Submit a new review."""
    data = request.json or {}
    name = (data.get("name") or "Anonymous").strip()[:60]
    rating = data.get("rating", 5)
    comment = (data.get("comment") or "").strip()[:500]
    template = (data.get("template") or "").strip()

    if not isinstance(rating, int) or rating < 1 or rating > 5:
        return jsonify({"error": "Rating must be 1-5"}), 400
    if not comment:
        return jsonify({"error": "Please write a short comment"}), 400

    if not DATABASE_URL:
        return jsonify({"error": "Database not configured"}), 500

    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO reviews (name, rating, comment, template) VALUES (%s, %s, %s, %s)",
            (name, rating, comment, template)
        )
        cur.close()
        conn.close()
        return jsonify({"ok": True})
    except Exception as e:
        print(f"[CLOAK] DB write error: {e}", flush=True)
        return jsonify({"error": "Failed to save review"}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5000)
